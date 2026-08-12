using System;
using System.Globalization;
using RenewalDeskBridge.Config;
using RenewalDeskBridge.Device;

namespace RenewalDeskBridge.AccessControl
{
    /// <summary>
    /// Enforces membership expiry with the X990's actual access-control mechanism:
    /// a dedicated per-user all-day-deny time zone.  The terminal's generic
    /// SSR_EnableUser flag is intentionally not used as the authoritative door rule;
    /// some X990 installations continue to energise the relay even when that flag
    /// reads back as disabled.
    /// </summary>
    public sealed class MembershipAccessService
    {
        // Seven days of 23:57-23:56.  On X990 access-control firmware an end time
        // earlier than the start time means access is forbidden for that whole day.
        public const string AllDayDenyTimeZoneDefinition =
            "23572356235723562357235623572356235723562357235623572356";

        private readonly DeviceConnection _device;
        private readonly AccessStateStore _stateStore;
        private readonly BridgeConfig _config;
        private readonly object _mutationLock = new object();

        public MembershipAccessService(DeviceConnection device, AccessStateStore stateStore,
                                       BridgeConfig config)
        {
            _device = device;
            _stateStore = stateStore;
            _config = config;
        }

        public MembershipAccessResult PrepareDenyTimeZone(int timeZoneId, bool ownerConfirmedUnused)
        {
            lock (_mutationLock)
            {
                if (!ownerConfirmedUnused)
                    return MembershipAccessResult.Fail(
                        "The reserved time-zone slot was not confirmed as unused. Nothing was changed.");

                if (timeZoneId < 2 || timeZoneId > 50)
                    return MembershipAccessResult.Fail(
                        "Choose a reserved time-zone ID from 2 to 50. Never overwrite the device default #1.");

                if (_config.MembershipAccessPolicyPrepared &&
                    timeZoneId != _config.MembershipDenyTimeZoneId)
                {
                    return MembershipAccessResult.Fail(
                        "A different deny time-zone is already prepared. Do not switch slots while member " +
                        "backups may still reference it; restore all affected users and arrange a controlled " +
                        "migration first.");
                }

                if (!TryGetSerial(out string serial, out MembershipAccessResult serialFailure))
                    return serialFailure;

                if (!_device.TryGetTimeZoneDefinition(timeZoneId, out string currentDefinition))
                    return DeviceFailure($"Could not read time zone #{timeZoneId} before changing it");

                if (!IsValidTimeZoneDefinition(currentDefinition))
                    return MembershipAccessResult.Fail(
                        $"Time zone #{timeZoneId} returned an unexpected definition. Nothing was changed.");

                TimeZonePolicyBackup backup;
                try
                {
                    backup = _stateStore.GetTimeZonePolicyBackup(serial, timeZoneId);
                }
                catch (Exception ex)
                {
                    return MembershipAccessResult.Fail("Could not read the local access-policy backup: " + ex.Message);
                }

                if (backup != null)
                {
                    if (!string.Equals(backup.DenyDefinition, AllDayDenyTimeZoneDefinition,
                                       StringComparison.Ordinal) ||
                        !string.Equals(currentDefinition, AllDayDenyTimeZoneDefinition,
                                       StringComparison.Ordinal))
                    {
                        return MembershipAccessResult.Fail(
                            $"Time zone #{timeZoneId} was previously managed by this bridge but no longer " +
                            "contains its deny rule. Stop and investigate; nothing was changed.");
                    }

                    bool keepExistingPhysicalVerification = _config.MembershipAccessPolicyPrepared &&
                                                            _config.MembershipAccessPolicyPhysicallyVerified &&
                                                            _config.MembershipDenyTimeZoneId == timeZoneId &&
                                                            string.Equals(_config.MembershipPolicyDeviceSerial, serial,
                                                                          StringComparison.Ordinal);
                    MarkPolicyPrepared(serial, timeZoneId, keepExistingPhysicalVerification);
                    return MembershipAccessResult.Ok(
                        $"Deny time zone #{timeZoneId} is already prepared and read-back verified. " +
                        "Use a safe non-admin member for the physical-door test next.");
                }

                bool adoptingExistingDenyRule =
                    string.Equals(currentDefinition, AllDayDenyTimeZoneDefinition, StringComparison.Ordinal);

                var newPolicyBackup = new TimeZonePolicyBackup
                {
                    DeviceSerial = serial,
                    DenyTimeZoneId = timeZoneId,
                    OriginalDefinition = currentDefinition,
                    DenyDefinition = AllDayDenyTimeZoneDefinition,
                    PreparedAtUtc = DateTime.UtcNow
                };

                try
                {
                    bool saved = _stateStore.TryCreateTimeZonePolicyBackup(newPolicyBackup);

                    if (!saved)
                        return MembershipAccessResult.Fail(
                            "Could not securely save the original reserved time-zone definition. Nothing was changed.");
                }
                catch (Exception ex)
                {
                    return MembershipAccessResult.Fail("Could not save the local access-policy backup: " + ex.Message);
                }

                // A freshly installed bridge may encounter a terminal that the
                // owner already configured with this dedicated all-day deny slot.
                // The caller has explicitly confirmed that the slot is unused;
                // record it as an adopted permanent deny slot without rewriting
                // the terminal. Its pre-bridge definition is unknown, so a later
                // rollback deliberately leaves this same deny definition in place
                // instead of guessing an old schedule.
                if (adoptingExistingDenyRule)
                {
                    MarkPolicyPrepared(serial, timeZoneId, physicallyVerified: false);
                    return MembershipAccessResult.Ok(
                        $"Deny time zone #{timeZoneId} already contains the verified all-day deny rule. " +
                        "This bridge adopted it as the dedicated membership-expiry slot; it was not changed. " +
                        "Run one safe physical-door test before automatic expiry is enabled.");
                }

                // A COM false result is not proof that no write occurred.  Always
                // inspect the actual terminal value; a mismatch triggers a verified
                // rollback before this global slot can be used by any member.
                _device.SetTimeZoneDefinition(timeZoneId, AllDayDenyTimeZoneDefinition);
                if (!_device.TryGetTimeZoneDefinition(timeZoneId, out string readBack) ||
                    !string.Equals(readBack, AllDayDenyTimeZoneDefinition, StringComparison.Ordinal))
                {
                    return RollBackUnconfirmedDenyTimeZone(serial, newPolicyBackup,
                        $"Time zone #{timeZoneId} did not read back as the deny rule");
                }

                MarkPolicyPrepared(serial, timeZoneId, physicallyVerified: false);
                return MembershipAccessResult.Ok(
                    $"Deny time zone #{timeZoneId} is prepared and read-back verified. It is not active for " +
                    "automatic membership expiry until a safe physical-door test passes.");
            }
        }

        /// <summary>
        /// Records a human physical-door result.  Software can verify COM read-back,
        /// but it cannot know whether the installed lock wiring obeys the terminal.
        /// </summary>
        public MembershipAccessResult MarkPhysicalTestPassed()
        {
            lock (_mutationLock)
            {
                if (!TryGetSerial(out string serial, out MembershipAccessResult serialFailure))
                    return serialFailure;

                var ready = EnsureDenyPolicyReady(serial, allowUnverified: true);
                if (!ready.Success) return ready;

                if (!HasCurrentVerifiedDenyTestCandidate(serial, out string candidateFailure))
                    return MembershipAccessResult.Fail(candidateFailure);

                _config.MembershipAccessPolicyPhysicallyVerified = true;
                _config.Save();
                return MembershipAccessResult.Ok(
                    "Physical access test marked as passed. Renewal Desk expiry commands may now use the " +
                    "verified deny time zone. Keep the reserved time-zone slot unchanged.");
            }
        }

        /// <summary>
        /// Applies the reserved all-day-deny time zone.  A manual test may run before
        /// physical verification; automatic cloud commands may not.
        /// </summary>
        public MembershipAccessResult DisableMembershipAccess(string enrollNumber, bool allowUnverifiedTest)
        {
            lock (_mutationLock)
            {
                if (!DeviceConnection.TryParseNumericDeviceUserId(enrollNumber, out _))
                    return MembershipAccessResult.Fail(
                        "Expiry access control requires the terminal's canonical numeric Enroll Number " +
                        "(for example 8), not a UUID, name, or leading-zero ID.");

                if (!TryGetSerial(out string serial, out MembershipAccessResult serialFailure))
                    return serialFailure;

                var ready = EnsureDenyPolicyReady(serial, allowUnverifiedTest);
                if (!ready.Success) return ready;

                int denyTimeZoneId = _config.MembershipDenyTimeZoneId;

                if (!_device.TryGetUserTimeZoneState(enrollNumber, out UserTimeZoneState currentState))
                    return DeviceFailure($"Could not read the access-control state for user {enrollNumber}");

                UserTimeZoneBackup existingBackup;
                try
                {
                    existingBackup = _stateStore.GetUserTimeZoneBackup(serial, enrollNumber);
                }
                catch (Exception ex)
                {
                    return MembershipAccessResult.Fail("Could not read the local user access backup: " + ex.Message);
                }

                if (existingBackup != null)
                {
                    // A record made before semantic group-vs-personal state was
                    // captured cannot be safely repaired by this build.  In
                    // particular, raw values such as "1:::" are not enough to
                    // decide whether the terminal is using a group schedule.
                    // Preserve the record exactly and make no device write.
                    if (!HasCompleteSemanticBackup(existingBackup))
                    {
                        return MembershipAccessResult.Fail(
                            $"User {enrollNumber} has a legacy pending recovery record without saved " +
                            "group/personal state. Nothing was changed. Use the terminal administrator " +
                            "to verify the user's access-control role, then contact support.");
                    }

                    if (existingBackup.DenyTimeZoneId != denyTimeZoneId)
                    {
                        return MembershipAccessResult.Fail(
                            $"User {enrollNumber} has a saved backup for a different deny time-zone. " +
                            "Do not overwrite it; investigate the previous setup first.");
                    }

                    if (IsOriginalState(currentState, existingBackup))
                    {
                        return ClearPendingBackupAfterVerifiedOriginal(
                            serial, enrollNumber,
                            $"User {enrollNumber}'s original semantic access state is already active");
                    }

                    if (HasVerifiedDenyState(currentState, denyTimeZoneId) &&
                        string.Equals(existingBackup.AppliedDenyTimeZones, currentState.RawTimeZones,
                                      StringComparison.Ordinal) &&
                        existingBackup.AppliedDenyUsesGroupTimeZone == false)
                    {
                        return MembershipAccessResult.Ok(
                            $"User {enrollNumber} is already assigned to personal deny time zone #{denyTimeZoneId}. " +
                            "The original access-state backup is retained.");
                    }

                    return MembershipAccessResult.Fail(
                        $"User {enrollNumber} has a pending recovery record, but the terminal's current " +
                        "semantic access state is not the saved original or verified deny state. " +
                        "Nothing was overwritten.");
                }

                if (!CanSafelyBackUpOriginalState(currentState))
                    return MembershipAccessResult.Fail(
                        $"User {enrollNumber}'s personal access-time-zone value ('{currentState.RawTimeZones}') " +
                        "is ambiguous. Nothing was changed.");

                if (HasVerifiedDenyState(currentState, denyTimeZoneId))
                {
                    return MembershipAccessResult.Fail(
                        $"User {enrollNumber} is already on the deny schedule, but no original schedule backup " +
                        "exists on this laptop. Do not continue; the bridge cannot restore access safely.");
                }

                var createdBackup = new UserTimeZoneBackup
                {
                    DeviceSerial = serial,
                    EnrollNumber = enrollNumber,
                    OriginalTimeZones = currentState.RawTimeZones,
                    OriginalUsesGroupTimeZone = currentState.UsesGroupTimeZone,
                    DenyTimeZoneId = denyTimeZoneId,
                    AppliedDenyTimeZones = null,
                    AppliedDenyUsesGroupTimeZone = null,
                    CreatedAtUtc = DateTime.UtcNow
                };

                try
                {
                    bool saved = _stateStore.TryCreateUserTimeZoneBackup(createdBackup);
                    if (!saved)
                        return MembershipAccessResult.Fail(
                            $"Could not securely save user {enrollNumber}'s original access schedule. " +
                            "Nothing was changed.");
                }
                catch (Exception ex)
                {
                    return MembershipAccessResult.Fail("Could not save the local user access backup: " + ex.Message);
                }

                // A COM false result is not proof that no terminal write occurred.
                // The helper immediately reads the BSTR plus its group/personal
                // selector and either records a verified semantic deny state or
                // performs a verified rollback.
                string deniedTimeZones = BuildPersonalDenyTimeZones(denyTimeZoneId);
                bool setReportedSuccess = _device.SetUserTimeZones(enrollNumber, deniedTimeZones);
                string operationNote = setReportedSuccess
                    ? $"Deny schedule '{deniedTimeZones}' was sent to user {enrollNumber}"
                    : $"The terminal did not confirm the deny write for user {enrollNumber}";
                return ConfirmDenyWriteOrRollBack(serial, enrollNumber, createdBackup, operationNote);
            }
        }

        /// <summary>
        /// Restores the exact schedule captured before expiry.  It intentionally
        /// refuses to overwrite a schedule that somebody changed at the terminal.
        /// </summary>
        public MembershipAccessResult RestoreMembershipAccess(string enrollNumber,
                                                              bool allowInitialActiveNoOp = false)
        {
            lock (_mutationLock)
            {
                if (!DeviceConnection.TryParseNumericDeviceUserId(enrollNumber, out _))
                    return MembershipAccessResult.Fail(
                        "Membership access restore requires the terminal's canonical numeric Enroll Number.");

                if (!TryGetSerial(out string serial, out MembershipAccessResult serialFailure))
                    return serialFailure;

                UserTimeZoneBackup backup;
                try
                {
                    backup = _stateStore.GetUserTimeZoneBackup(serial, enrollNumber);
                }
                catch (Exception ex)
                {
                    return MembershipAccessResult.Fail("Could not read the local user access backup: " + ex.Message);
                }

                if (backup == null)
                {
                    // A newly enrolled, already-active member has never been
                    // denied by this bridge, so there is no schedule to restore.
                    // Do not guess and overwrite their terminal settings.  We do
                    // however reject an active command if the terminal still has
                    // our deny schedule but the local recovery record is missing.
                    // That requires an operator recovery, not a blind grant.
                    if (allowInitialActiveNoOp)
                    {
                        if (!_device.TryGetUserTimeZoneState(enrollNumber, out UserTimeZoneState initialState))
                            return DeviceFailure($"Could not read the access-control state for user {enrollNumber}");

                        if (HasVerifiedDenyState(initialState, _config.MembershipDenyTimeZoneId))
                        {
                            return MembershipAccessResult.Fail(
                                $"User {enrollNumber} is still on the membership deny schedule, but this laptop " +
                                "has no original-access backup. Nothing was changed; restore the user with the " +
                                "terminal administrator before retrying.");
                        }

                        return MembershipAccessResult.Ok(
                            $"User {enrollNumber} has no bridge-issued deny record. The active-membership " +
                            "command was acknowledged without changing the terminal; this is the expected " +
                            "initial-enrollment baseline.");
                    }

                    return MembershipAccessResult.Fail(
                        $"User {enrollNumber} has no local semantic access-state backup. " +
                        "Nothing was changed; refusing to guess a restore schedule.");
                }

                // Do not reinterpret old pending records.  Their raw field alone
                // cannot prove whether the terminal was using group time zones.
                if (!HasCompleteSemanticBackup(backup))
                {
                    return MembershipAccessResult.Fail(
                        $"User {enrollNumber} has a legacy pending recovery record without saved " +
                        "group/personal state. Nothing was changed. Restore only with the terminal administrator.");
                }

                if (!_device.TryGetUserTimeZoneState(enrollNumber, out UserTimeZoneState currentState))
                    return DeviceFailure($"Could not read the access-control state for user {enrollNumber}");

                if (IsOriginalState(currentState, backup))
                {
                    try
                    {
                        _stateStore.DeleteUserTimeZoneBackup(serial, enrollNumber);
                        return MembershipAccessResult.Ok(
                            $"User {enrollNumber}'s original semantic access state is already active. " +
                            "The stale local recovery record was cleared.");
                    }
                    catch (Exception ex)
                    {
                        return MembershipAccessResult.Fail(
                            $"User {enrollNumber}'s original access state is already active, but the stale " +
                            "local recovery record could not be cleared: " + ex.Message);
                    }
                }

                if (backup.AppliedDenyUsesGroupTimeZone != false ||
                    string.IsNullOrWhiteSpace(backup.AppliedDenyTimeZones) ||
                    !HasVerifiedDenyState(currentState, backup.DenyTimeZoneId))
                {
                    return MembershipAccessResult.Fail(
                        $"User {enrollNumber}'s terminal state is not a verified bridge deny state. " +
                        "Nothing was overwritten.");
                }

                string restoreTimeZones = backup.OriginalUsesGroupTimeZone.Value
                    ? "0:0:0:0"
                    : backup.OriginalTimeZones;

                _device.SetUserTimeZones(enrollNumber, restoreTimeZones);
                if (!_device.TryGetUserTimeZoneState(enrollNumber, out UserTimeZoneState restoredState) ||
                    !IsOriginalState(restoredState, backup))
                {
                    return MembershipAccessResult.Fail(
                        $"User {enrollNumber}'s original semantic access state could not be verified after restore. " +
                        "The local backup was retained for recovery.");
                }

                try
                {
                    _stateStore.DeleteUserTimeZoneBackup(serial, enrollNumber);
                }
                catch (Exception ex)
                {
                    return MembershipAccessResult.Fail(
                        $"User {enrollNumber}'s access schedule was restored and verified, but the local backup " +
                        "could not be cleared: " + ex.Message);
                }

                return MembershipAccessResult.Ok(
                    $"User {enrollNumber}'s original semantic access state was restored and verified.");
            }
        }

        public string DescribePolicyStatus()
        {
            if (!_config.MembershipAccessPolicyPrepared)
                return "Expiry policy: NOT PREPARED — automatic expiry commands are locked.";
            if (!_config.MembershipAccessPolicyPhysicallyVerified)
                return $"Expiry policy: TZ #{_config.MembershipDenyTimeZoneId} prepared — physical door test required.";
            return $"Expiry policy: TZ #{_config.MembershipDenyTimeZoneId} PHYSICALLY VERIFIED — automatic expiry enabled.";
        }

        private MembershipAccessResult EnsureDenyPolicyReady(string serial, bool allowUnverified)
        {
            if (!_config.MembershipAccessPolicyPrepared)
                return MembershipAccessResult.Fail(
                    "Expiry access policy is not prepared. Reserve a safe time-zone slot first.");

            if (!string.Equals(_config.MembershipPolicyDeviceSerial, serial, StringComparison.Ordinal))
                return MembershipAccessResult.Fail(
                    "This terminal is not the device that was prepared for membership expiry. " +
                    "Automatic access changes are locked until it is prepared and physically tested.");

            if (!_config.MembershipAccessPolicyPhysicallyVerified && !allowUnverified)
                return MembershipAccessResult.Fail(
                    "Automatic expiry is locked until a safe non-admin physical door test has passed.");

            int denyTimeZoneId = _config.MembershipDenyTimeZoneId;
            if (denyTimeZoneId < 2 || denyTimeZoneId > 50)
                return MembershipAccessResult.Fail("Configured deny time-zone ID is invalid.");

            TimeZonePolicyBackup policy;
            try
            {
                policy = _stateStore.GetTimeZonePolicyBackup(serial, denyTimeZoneId);
            }
            catch (Exception ex)
            {
                return MembershipAccessResult.Fail("Could not read the local policy backup: " + ex.Message);
            }

            if (policy == null || !string.Equals(policy.DenyDefinition, AllDayDenyTimeZoneDefinition,
                                                  StringComparison.Ordinal))
            {
                return MembershipAccessResult.Fail(
                    "The local original time-zone backup is missing. Automatic access changes are locked.");
            }

            if (!_device.TryGetTimeZoneDefinition(denyTimeZoneId, out string currentDefinition))
                return DeviceFailure($"Could not read reserved time zone #{denyTimeZoneId}");

            if (!string.Equals(currentDefinition, AllDayDenyTimeZoneDefinition, StringComparison.Ordinal))
            {
                return MembershipAccessResult.Fail(
                    $"Reserved deny time zone #{denyTimeZoneId} was changed on the terminal. " +
                    "Automatic access changes are locked until it is investigated.");
            }

            return MembershipAccessResult.Ok("Expiry policy is ready.");
        }

        /// <summary>
        /// A human may click the UI confirmation only while a successful manual
        /// test assignment is still active.  This prevents an operator from
        /// accidentally enabling automatic expiry after a failed or merely
        /// configured (but never applied) test.
        /// </summary>
        private bool HasCurrentVerifiedDenyTestCandidate(string serial, out string failure)
        {
            failure = string.Empty;
            System.Collections.Generic.List<UserTimeZoneBackup> candidates;
            try
            {
                candidates = _stateStore.GetAppliedDenyBackups(serial);
            }
            catch (Exception ex)
            {
                failure = "Could not read the local physical-test record: " + ex.Message;
                return false;
            }

            if (candidates.Count == 0)
            {
                failure = "Automatic expiry remains locked. First run 'Expire / test access' for one safe " +
                          "non-admin member and confirm a semantic deny read-back before reporting the " +
                          "physical-door result.";
                return false;
            }

            int denyTimeZoneId = _config.MembershipDenyTimeZoneId;
            foreach (UserTimeZoneBackup candidate in candidates)
            {
                if (candidate.DenyTimeZoneId != denyTimeZoneId ||
                    candidate.AppliedDenyUsesGroupTimeZone != false ||
                    string.IsNullOrWhiteSpace(candidate.AppliedDenyTimeZones))
                {
                    continue;
                }

                if (_device.TryGetUserTimeZoneState(candidate.EnrollNumber,
                                                     out UserTimeZoneState currentState) &&
                    HasVerifiedDenyState(currentState, denyTimeZoneId) &&
                    string.Equals(currentState.RawTimeZones, candidate.AppliedDenyTimeZones,
                                  StringComparison.Ordinal))
                {
                    return true;
                }
            }

            failure = "Automatic expiry remains locked. No currently active, semantically verified deny test " +
                      "assignment was found on this terminal. Do not mark the physical test as passed.";
            return false;
        }

        private bool TryGetSerial(out string serial, out MembershipAccessResult failure)
        {
            serial = string.Empty;
            failure = null;
            if (!_device.IsConnected)
            {
                failure = MembershipAccessResult.Fail("Connect to the biometric device first.");
                return false;
            }

            if (!_device.TryGetDeviceSerialNumber(out serial))
            {
                failure = DeviceFailure("Could not read the biometric device serial number");
                return false;
            }

            serial = serial.Trim();
            return true;
        }

        private void MarkPolicyPrepared(string serial, int timeZoneId, bool physicallyVerified)
        {
            _config.MembershipDenyTimeZoneId = timeZoneId;
            _config.MembershipPolicyDeviceSerial = serial;
            _config.MembershipAccessPolicyPrepared = true;
            _config.MembershipAccessPolicyPhysicallyVerified = physicallyVerified;
            _config.Save();
        }

        private MembershipAccessResult DeviceFailure(string action)
        {
            return MembershipAccessResult.Fail(action + ". Device error code: " + _device.GetLastErrorCode() + ".");
        }

        /// <summary>
        /// Confirms a deny write using semantic state, not raw BSTR equality. A
        /// valid X990 deny must be personal (UseGroupTimeZone == false) and must
        /// contain only the reserved deny time zone as its first time zone.
        /// </summary>
        private MembershipAccessResult ConfirmDenyWriteOrRollBack(string serial,
                                                                  string enrollNumber,
                                                                  UserTimeZoneBackup backup,
                                                                  string operationNote)
        {
            if (_device.TryGetUserTimeZoneState(enrollNumber, out UserTimeZoneState readBack) &&
                HasVerifiedDenyState(readBack, backup.DenyTimeZoneId))
            {
                try
                {
                    if (_stateStore.TryMarkUserTimeZoneDenyApplied(serial, enrollNumber,
                                                                     readBack.RawTimeZones,
                                                                     readBack.UsesGroupTimeZone))
                    {
                        string testNote = _config.MembershipAccessPolicyPhysicallyVerified
                            ? "Physically test a scan once after changing any new device configuration."
                            : "TEST MODE: now physically test a safe non-admin fingerprint. If the door stays " +
                              "locked, click 'Mark physical test passed', then restore this user.";
                        return MembershipAccessResult.Ok(
                            $"User {enrollNumber} was assigned to personal deny time zone " +
                            $"#{backup.DenyTimeZoneId}; terminal semantic read-back confirmed. {testNote}");
                    }
                }
                catch (Exception ex)
                {
                    return RollBackUnconfirmedDenyWrite(
                        serial, enrollNumber, backup,
                        operationNote + "; local recovery-record update failed: " + ex.Message);
                }

                return RollBackUnconfirmedDenyWrite(
                    serial, enrollNumber, backup,
                    operationNote + "; the local recovery record could not be finalised");
            }

            return RollBackUnconfirmedDenyWrite(
                serial, enrollNumber, backup,
                operationNote + "; terminal deny-state verification failed");
        }

        /// <summary>
        /// Emergency rollback used only before a deny state is durably recorded.
        /// It restores a group user through the X990 group BSTR (0:0:0:0), not
        /// through a guessed copy of the user's raw GetUserTZStr response.
        /// </summary>
        private MembershipAccessResult RollBackUnconfirmedDenyWrite(string serial,
                                                                     string enrollNumber,
                                                                     UserTimeZoneBackup backup,
                                                                     string reason)
        {
            if (_device.TryGetUserTimeZoneState(enrollNumber, out UserTimeZoneState current) &&
                IsOriginalState(current, backup))
            {
                return ClearPendingBackupAfterVerifiedOriginal(
                    serial, enrollNumber, reason + "; the original semantic access state is active and verified");
            }

            string restoreTimeZones = backup.OriginalUsesGroupTimeZone == true
                ? "0:0:0:0"
                : backup.OriginalTimeZones;
            _device.SetUserTimeZones(enrollNumber, restoreTimeZones);
            if (_device.TryGetUserTimeZoneState(enrollNumber, out UserTimeZoneState restored) &&
                IsOriginalState(restored, backup))
            {
                return ClearPendingBackupAfterVerifiedOriginal(
                    serial, enrollNumber, reason +
                    "; the bridge immediately restored and verified the original semantic access state");
            }

            return MembershipAccessResult.Fail(
                reason + ". The bridge attempted to restore the original access state but could not verify it. " +
                $"Stop testing user {enrollNumber}; use the terminal administrator to restore the user's " +
                "access-control role, then contact support. The local recovery record was retained.");
        }

        private MembershipAccessResult ClearPendingBackupAfterVerifiedOriginal(string serial,
                                                                                string enrollNumber,
                                                                                string message)
        {
            try
            {
                _stateStore.DeleteUserTimeZoneBackup(serial, enrollNumber);
                return MembershipAccessResult.Fail(message + ". No member access change remains active.");
            }
            catch (Exception ex)
            {
                return MembershipAccessResult.Fail(
                    message + ", but the local pending recovery record could not be cleared: " + ex.Message +
                    ". Do not retry until that local record is repaired.");
            }
        }

        private MembershipAccessResult RollBackUnconfirmedDenyTimeZone(string serial,
                                                                        TimeZonePolicyBackup backup,
                                                                        string reason)
        {
            if (_device.TryGetTimeZoneDefinition(backup.DenyTimeZoneId, out string current) &&
                string.Equals(current, backup.OriginalDefinition, StringComparison.Ordinal))
            {
                return ClearPolicyBackupAfterVerifiedRollback(serial, backup, reason +
                    "; the original time-zone definition is still active and verified");
            }

            _device.SetTimeZoneDefinition(backup.DenyTimeZoneId, backup.OriginalDefinition);
            if (_device.TryGetTimeZoneDefinition(backup.DenyTimeZoneId, out string restored) &&
                string.Equals(restored, backup.OriginalDefinition, StringComparison.Ordinal))
            {
                return ClearPolicyBackupAfterVerifiedRollback(serial, backup, reason +
                    "; the original time-zone definition was immediately restored and verified");
            }

            return MembershipAccessResult.Fail(
                reason + ". The bridge attempted to restore the original definition but could not verify it. " +
                $"Stop all membership tests; restore time zone #{backup.DenyTimeZoneId} on the terminal from " +
                "a device backup, then contact support. The local recovery record was retained.");
        }

        private MembershipAccessResult ClearPolicyBackupAfterVerifiedRollback(string serial,
                                                                                TimeZonePolicyBackup backup,
                                                                                string message)
        {
            try
            {
                _stateStore.DeleteTimeZonePolicyBackup(serial, backup.DenyTimeZoneId);
                return MembershipAccessResult.Fail(message + ". No deny policy remains prepared.");
            }
            catch (Exception ex)
            {
                return MembershipAccessResult.Fail(
                    message + ", but the local policy recovery record could not be cleared: " + ex.Message +
                    ". Do not retry until that local record is repaired.");
            }
        }

        private static string BuildPersonalDenyTimeZones(int denyTimeZoneId)
        {
            return denyTimeZoneId.ToString(CultureInfo.InvariantCulture) + ":0:0:1";
        }

        private static bool HasCompleteSemanticBackup(UserTimeZoneBackup backup)
        {
            return backup != null && backup.OriginalUsesGroupTimeZone.HasValue;
        }

        private static bool CanSafelyBackUpOriginalState(UserTimeZoneState state)
        {
            if (state == null || string.IsNullOrWhiteSpace(state.RawTimeZones)) return false;

            // Group users are restored by the explicit group BSTR and semantic
            // UseGroupTimeZone=true check. The raw group read-back is retained
            // for audit but is not treated as a portable configuration string.
            if (state.UsesGroupTimeZone) return true;

            return TryParsePersonalTimeZones(state.RawTimeZones,
                                             out int ignoredFirst,
                                             out int ignoredSecond,
                                             out int ignoredThird,
                                             out int ignoredMode);
        }

        private static bool HasVerifiedDenyState(UserTimeZoneState state, int denyTimeZoneId)
        {
            if (state == null || state.UsesGroupTimeZone ||
                denyTimeZoneId < 2 || denyTimeZoneId > 50)
            {
                return false;
            }

            return TryParsePersonalTimeZones(state.RawTimeZones,
                                             out int first,
                                             out int second,
                                             out int third,
                                             out int mode) &&
                   first == denyTimeZoneId && second == 0 && third == 0 && mode == 1;
        }

        private static bool IsOriginalState(UserTimeZoneState state, UserTimeZoneBackup backup)
        {
            if (!HasCompleteSemanticBackup(backup) || state == null) return false;

            if (backup.OriginalUsesGroupTimeZone.Value)
            {
                // Raw group replies vary by firmware; the immediately-read
                // semantic selector is the authoritative confirmation.
                return state.UsesGroupTimeZone;
            }

            if (state.UsesGroupTimeZone) return false;

            return AreSamePersonalTimeZones(state.RawTimeZones, backup.OriginalTimeZones);
        }

        private static bool AreSamePersonalTimeZones(string firstRaw, string secondRaw)
        {
            return TryParsePersonalTimeZones(firstRaw, out int firstOne, out int secondOne,
                                             out int thirdOne, out int modeOne) &&
                   TryParsePersonalTimeZones(secondRaw, out int firstTwo, out int secondTwo,
                                             out int thirdTwo, out int modeTwo) &&
                   firstOne == firstTwo && secondOne == secondTwo &&
                   thirdOne == thirdTwo && modeOne == modeTwo;
        }

        /// <summary>
        /// Accept the X990 personal BSTR form TZ1:TZ2:TZ3:1.  This terminal
        /// canonicalises zero-valued trailing time zones to empty fields: for
        /// example, the manual UI's Time Period 1 = 50, 2 = 0, 3 = 0 is read
        /// back as <c>50:::1</c>.  Treat those empty optional fields as zero,
        /// but keep the final personal-mode flag mandatory.  Callers combine
        /// this parser with the immediately-read UseGroupTimeZone value before
        /// accepting a state, so an ambiguous group reply is never used for a
        /// write or restore.
        /// </summary>
        private static bool TryParsePersonalTimeZones(string raw,
                                                      out int first,
                                                      out int second,
                                                      out int third,
                                                      out int mode)
        {
            first = second = third = mode = 0;
            if (string.IsNullOrWhiteSpace(raw)) return false;

            string[] parts = raw.Trim().Split(':');
            if (parts.Length != 4 ||
                !TryParseTimeZoneNumber(parts[0], allowZero: false, out first) ||
                !TryParseOptionalTimeZoneNumber(parts[1], out second) ||
                !TryParseOptionalTimeZoneNumber(parts[2], out third) ||
                !int.TryParse(parts[3], NumberStyles.None, CultureInfo.InvariantCulture, out mode))
            {
                return false;
            }

            return mode == 1;
        }

        private static bool TryParseTimeZoneNumber(string value, bool allowZero, out int timeZoneId)
        {
            timeZoneId = 0;
            if (!int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out timeZoneId))
                return false;

            return timeZoneId >= (allowZero ? 0 : 1) && timeZoneId <= 50;
        }

        private static bool TryParseOptionalTimeZoneNumber(string value, out int timeZoneId)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                timeZoneId = 0;
                return true;
            }

            return TryParseTimeZoneNumber(value, allowZero: true, out timeZoneId);
        }

        private static bool IsValidTimeZoneDefinition(string value)
        {
            if (string.IsNullOrEmpty(value) || value.Length != 56) return false;
            for (int i = 0; i < value.Length; i++)
            {
                if (value[i] < '0' || value[i] > '9') return false;
            }
            return true;
        }

    }

    public sealed class MembershipAccessResult
    {
        public bool Success { get; private set; }
        public string Message { get; private set; }

        public static MembershipAccessResult Ok(string message)
        {
            return new MembershipAccessResult { Success = true, Message = message };
        }

        public static MembershipAccessResult Fail(string message)
        {
            return new MembershipAccessResult { Success = false, Message = message };
        }
    }
}
