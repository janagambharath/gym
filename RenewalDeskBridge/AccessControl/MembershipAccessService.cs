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

                if (string.Equals(currentDefinition, AllDayDenyTimeZoneDefinition, StringComparison.Ordinal))
                {
                    return MembershipAccessResult.Fail(
                        $"Time zone #{timeZoneId} already contains a deny rule but this bridge has no local " +
                        "backup proving it owns that slot. Choose another confirmed-unused slot.");
                }

                try
                {
                    bool saved = _stateStore.TryCreateTimeZonePolicyBackup(new TimeZonePolicyBackup
                    {
                        DeviceSerial = serial,
                        DenyTimeZoneId = timeZoneId,
                        OriginalDefinition = currentDefinition,
                        DenyDefinition = AllDayDenyTimeZoneDefinition,
                        PreparedAtUtc = DateTime.UtcNow
                    });

                    if (!saved)
                        return MembershipAccessResult.Fail(
                            "Could not securely save the original reserved time-zone definition. Nothing was changed.");
                }
                catch (Exception ex)
                {
                    return MembershipAccessResult.Fail("Could not save the local access-policy backup: " + ex.Message);
                }

                if (!_device.SetTimeZoneDefinition(timeZoneId, AllDayDenyTimeZoneDefinition))
                    return DeviceFailure(
                        $"The original definition for time zone #{timeZoneId} was saved, but the terminal " +
                        "did not confirm the deny-rule write. Do not run expiry commands; inspect the device first");

                if (!_device.TryGetTimeZoneDefinition(timeZoneId, out string readBack) ||
                    !string.Equals(readBack, AllDayDenyTimeZoneDefinition, StringComparison.Ordinal))
                {
                    return MembershipAccessResult.Fail(
                        $"Time zone #{timeZoneId} did not read back as the deny rule. Automatic expiry remains locked.");
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
                string deniedTimeZones = BuildDeniedUserTimeZones(denyTimeZoneId);

                if (!_device.TryGetUserTimeZones(enrollNumber, out string currentTimeZones))
                    return DeviceFailure($"Could not read access time zones for user {enrollNumber}");

                if (!IsExpectedUserTimeZoneString(currentTimeZones))
                    return MembershipAccessResult.Fail(
                        $"User {enrollNumber} returned an unexpected access-time-zone format " +
                        $"('{currentTimeZones}'). Nothing was changed.");

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
                    if (existingBackup.DenyTimeZoneId != denyTimeZoneId)
                    {
                        return MembershipAccessResult.Fail(
                            $"User {enrollNumber} has a saved backup for a different deny time-zone. " +
                            "Do not overwrite it; investigate the previous setup first.");
                    }

                    if (string.Equals(currentTimeZones, deniedTimeZones, StringComparison.Ordinal))
                    {
                        return MembershipAccessResult.Ok(
                            $"User {enrollNumber} is already assigned to deny time zone #{denyTimeZoneId}. " +
                            "The original schedule backup is still safely retained.");
                    }

                    return MembershipAccessResult.Fail(
                        $"User {enrollNumber}'s access schedule changed after the bridge saved its backup " +
                        $"(current '{currentTimeZones}'). Nothing was overwritten.");
                }

                if (string.Equals(currentTimeZones, deniedTimeZones, StringComparison.Ordinal))
                {
                    return MembershipAccessResult.Fail(
                        $"User {enrollNumber} is already on the deny schedule, but no original schedule backup " +
                        "exists on this laptop. Do not continue; the bridge cannot restore access safely.");
                }

                try
                {
                    bool saved = _stateStore.TryCreateUserTimeZoneBackup(new UserTimeZoneBackup
                    {
                        DeviceSerial = serial,
                        EnrollNumber = enrollNumber,
                        OriginalTimeZones = currentTimeZones,
                        DenyTimeZoneId = denyTimeZoneId,
                        CreatedAtUtc = DateTime.UtcNow
                    });
                    if (!saved)
                        return MembershipAccessResult.Fail(
                            $"Could not securely save user {enrollNumber}'s original access schedule. " +
                            "Nothing was changed.");
                }
                catch (Exception ex)
                {
                    return MembershipAccessResult.Fail("Could not save the local user access backup: " + ex.Message);
                }

                if (!_device.SetUserTimeZones(enrollNumber, deniedTimeZones))
                    return DeviceFailure(
                        $"The original access schedule was saved, but the terminal did not confirm " +
                        $"the deny rule for user {enrollNumber}");

                if (!_device.TryGetUserTimeZones(enrollNumber, out string readBack) ||
                    !string.Equals(readBack, deniedTimeZones, StringComparison.Ordinal))
                {
                    return MembershipAccessResult.Fail(
                        $"User {enrollNumber}'s access schedule did not read back as '{deniedTimeZones}'. " +
                        "Automatic expiry remains unavailable for this user.");
                }

                string testNote = _config.MembershipAccessPolicyPhysicallyVerified
                    ? "Physically test a scan once after changing any new device configuration."
                    : "TEST MODE: now physically test a safe non-admin fingerprint. If the door stays " +
                      "locked, click 'Mark physical test passed', then restore this user.";
                return MembershipAccessResult.Ok(
                    $"User {enrollNumber} was assigned to deny time zone #{denyTimeZoneId} " +
                    $"({deniedTimeZones}); device read-back confirmed. {testNote}");
            }
        }

        /// <summary>
        /// Restores the exact schedule captured before expiry.  It intentionally
        /// refuses to overwrite a schedule that somebody changed at the terminal.
        /// </summary>
        public MembershipAccessResult RestoreMembershipAccess(string enrollNumber)
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
                    bool readUserTimeZones = _device.TryGetUserTimeZones(enrollNumber, out string legacyCurrentTimeZones);
                    if (readUserTimeZones &&
                        string.Equals(legacyCurrentTimeZones, BuildDeniedUserTimeZones(_config.MembershipDenyTimeZoneId),
                                      StringComparison.Ordinal))
                    {
                        return MembershipAccessResult.Fail(
                            $"User {enrollNumber} is on the deny schedule but this laptop has no saved original " +
                            "schedule. Refusing to guess an access rule. Restore it from the terminal backup or " +
                            "the original bridge laptop.");
                    }

                    // This also repairs a member left disabled by the bridge version
                    // that used SSR_EnableUser.  It does not alter a member's schedule.
                    if (!_device.SetUserEnabled(enrollNumber, true))
                        return DeviceFailure($"Could not restore legacy account availability for user {enrollNumber}");

                    string readNote = readUserTimeZones
                        ? "Its access time zones were left unchanged."
                        : "Its access time zones could not be read, so no schedule was changed.";
                    return MembershipAccessResult.Ok(
                        $"User {enrollNumber} has no membership schedule backup on this laptop. " + readNote +
                        " Legacy account availability was set to enabled.");
                }

                if (!_device.TryGetUserTimeZones(enrollNumber, out string currentTimeZones))
                    return DeviceFailure($"Could not read access time zones for user {enrollNumber}");

                string deniedTimeZones = BuildDeniedUserTimeZones(backup.DenyTimeZoneId);
                if (!string.Equals(currentTimeZones, deniedTimeZones, StringComparison.Ordinal))
                {
                    return MembershipAccessResult.Fail(
                        $"User {enrollNumber}'s current access schedule ('{currentTimeZones}') is no longer the " +
                        $"bridge deny value ('{deniedTimeZones}'). Someone may have edited the terminal directly; " +
                        "the bridge refused to overwrite that change.");
                }

                if (!_device.SetUserTimeZones(enrollNumber, backup.OriginalTimeZones))
                    return DeviceFailure($"Could not restore the original access schedule for user {enrollNumber}");

                if (!_device.TryGetUserTimeZones(enrollNumber, out string readBack) ||
                    !string.Equals(readBack, backup.OriginalTimeZones, StringComparison.Ordinal))
                {
                    return MembershipAccessResult.Fail(
                        $"User {enrollNumber}'s original access schedule did not read back after restore. " +
                        "The local backup was intentionally retained for recovery.");
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

                // Best-effort repair for older bridge builds.  A false return here
                // does not undo the verified schedule restore, so do not report the
                // renewal as failed solely because this legacy flag is unsupported.
                bool legacyEnabled = _device.SetUserEnabled(enrollNumber, true);
                string legacyNote = legacyEnabled
                    ? " Legacy account availability was also set to enabled."
                    : " The original schedule is restored; legacy account-availability update was not confirmed.";

                return MembershipAccessResult.Ok(
                    $"User {enrollNumber}'s original access schedule was restored and read-back verified." +
                    legacyNote);
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

        private static string BuildDeniedUserTimeZones(int denyTimeZoneId)
        {
            return denyTimeZoneId.ToString(CultureInfo.InvariantCulture) + ":0:0:1";
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

        private static bool IsExpectedUserTimeZoneString(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return false;
            string[] parts = value.Split(':');
            if (parts.Length != 4) return false;

            for (int i = 0; i < 3; i++)
            {
                if (!int.TryParse(parts[i], NumberStyles.None, CultureInfo.InvariantCulture, out int timeZoneId) ||
                    timeZoneId < 0 || timeZoneId > 50)
                    return false;
            }

            return parts[3] == "0" || parts[3] == "1";
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
