using System;
using System.Globalization;
using zkemkeeper;

namespace RenewalDeskBridge.Device
{
    /// <summary>
    /// Thin wrapper around the eSSL/ZKTeco zkemkeeper.dll COM object.
    ///
    /// Every method signature here is copied EXACTLY from the SDK's own demo source
    /// (Communication Protocol SDK (Ver6.3.1.55)N/Demo/C#/IFace/*), not guessed:
    ///   - Connect_Net(string ip, int port)              -> AccessControl demo, ACMain.cs
    ///   - ACUnlock(int machineNumber, int delayTenths)   -> AccessControl demo, ACMain.cs
    ///   - SSR_EnableUser(int, string, bool)              -> TFT UserInfo demo
    ///   - SSR_SetUserInfo(int, string, string, string, int, bool) -> UserInfo demo
    ///   - RegEvent(int machineNumber, int eventMask)     -> AccessControl demo
    ///   - OnAttTransactionEx event signature             -> RTEvents demo, RTEventsMain.cs
    ///
    /// IMPORTANT: sdwEnrollNumber (the user ID) is a STRING in this SDK, not an int.
    /// Renewal Desk's member IDs should be mapped to short numeric-looking strings
    /// (the device has real limits on ID length/format - test with a real ID early).
    /// </summary>
    public class DeviceConnection : IDisposable
    {
        private readonly CZKEMClass _zk = new CZKEMClass();
        private int _machineNumber = 1;
        private bool _isConnected;
        private bool _attendanceEventsSubscribed;

        public bool IsConnected => _isConnected;

        /// <summary>Fired whenever the device reports a scan/attendance event in real time.</summary>
        public event Action<AttendanceEvent> OnAttendance;

        /// <summary>Fired when connection is lost unexpectedly, so the caller can trigger reconnect logic.</summary>
        public event Action OnDisconnected;

        public DeviceConnection()
        {
            // Deliberately do not attach an event sink here. Some X990 firmware
            // builds terminate the hosting process while marshaling a real-time
            // attendance event, even when the application does not call RegEvent.
            // The sink is attached only for an explicit, tested opt-in connection.
        }

        public bool Connect(string ip, int port, string commPassword, int machineNumber,
                            bool registerLiveAttendanceEvents = false)
        {
            _machineNumber = machineNumber;

            if (!string.IsNullOrEmpty(commPassword))
            {
                _zk.SetCommPasswordEx(commPassword);
            }

            _isConnected = _zk.Connect_Net(ip, port);

            if (_isConnected)
            {
                if (registerLiveAttendanceEvents)
                {
                    if (!_attendanceEventsSubscribed)
                    {
                        _zk.OnAttTransactionEx += Zk_OnAttTransactionEx;
                        _attendanceEventsSubscribed = true;
                    }

                    // 65535 registers ALL real-time event types, matching the demo's
                    // own comment: "registering all". This is opt-in because some
                    // older terminal firmware destabilises a .NET host on callbacks.
                    _zk.RegEvent(_machineNumber, 65535);
                }
            }

            return _isConnected;
        }

        public void Disconnect()
        {
            if (_attendanceEventsSubscribed)
            {
                try
                {
                    _zk.OnAttTransactionEx -= Zk_OnAttTransactionEx;
                }
                catch
                {
                    // Disconnect must continue even if a broken COM connection
                    // point rejects an event-sink removal.
                }
                finally
                {
                    _attendanceEventsSubscribed = false;
                }
            }

            if (_isConnected)
            {
                _zk.Disconnect();
                _isConnected = false;
            }
        }

        public int GetLastErrorCode()
        {
            int code = 0;
            _zk.GetLastError(ref code);
            return code;
        }

        /// <summary>
        /// Unlocks the door relay for the requested number of whole seconds, then it
        /// re-locks automatically. The SDK's ACUnlock delay unit is one tenth of a
        /// second, so convert the UI-facing seconds here.
        /// </summary>
        public bool UnlockDoor(int delaySeconds)
        {
            if (!_isConnected) return false;
            int delayTenths = Math.Max(1, delaySeconds) * 10;
            return _zk.ACUnlock(_machineNumber, delayTenths);
        }

        /// <summary>
        /// Creates or updates a user profile. Use SetUserEnabled for an existing
        /// account's availability: the vendor SDK provides SSR_EnableUser as the
        /// dedicated TFT/IFACE operation for that purpose.
        ///
        /// enrollNumber is a STRING - map your Renewal Desk member ID to a short numeric
        /// string (e.g. "10234"), don't pass a UUID or anything with special characters
        /// until you've confirmed the device firmware accepts it (test this early).
        /// </summary>
        public bool SetUser(string enrollNumber, string name, bool enabled, int privilege = 0, string password = "")
        {
            if (!_isConnected) return false;
            bool ok = _zk.SSR_SetUserInfo(_machineNumber, enrollNumber, name, password, privilege, enabled);
            if (ok)
            {
                ok = _zk.RefreshData(_machineNumber); // commits pending changes - demo calls this after batches
            }
            return ok;
        }

        /// <summary>
        /// Sets whether an existing user account is available to verify. This must use
        /// SSR_EnableUser rather than rewriting the user's profile with
        /// SSR_SetUserInfo: the vendor TFT UserInfo demo uses this dedicated method for
        /// enable/disable operations.
        /// </summary>
        public bool SetUserEnabled(string enrollNumber, bool enabled)
        {
            if (!_isConnected) return false;

            bool ok = _zk.SSR_EnableUser(_machineNumber, enrollNumber, enabled);
            if (ok)
            {
                ok = _zk.RefreshData(_machineNumber);
            }
            return ok;
        }

        /// <summary>
        /// Reads back an existing user's account-availability flag after a change.
        /// A successful write alone never proves that the terminal will deny physical
        /// access, so callers must also perform a real fingerprint test.
        /// </summary>
        public bool TryGetUserEnabled(string enrollNumber, out bool enabled)
        {
            enabled = false;
            if (!_isConnected) return false;

            string name;
            string password;
            int privilege;
            return _zk.SSR_GetUserInfo(_machineNumber, enrollNumber, out name, out password,
                                       out privilege, out enabled);
        }

        /// <summary>
        /// Confirms that an existing TFT/IFACE terminal user can be read before
        /// binding its Enroll Number to a Renewal Desk member.  This never
        /// creates or edits a fingerprint/template.
        /// </summary>
        public bool TryGetUserProfile(string enrollNumber, out DeviceUserProfile profile)
        {
            profile = null;
            if (!_isConnected) return false;

            string name;
            string password;
            int privilege;
            bool enabled;
            bool ok = _zk.SSR_GetUserInfo(_machineNumber, enrollNumber, out name, out password,
                                           out privilege, out enabled);
            if (ok)
            {
                profile = new DeviceUserProfile
                {
                    Name = name ?? string.Empty,
                    Privilege = privilege,
                    Enabled = enabled
                };
            }
            return ok;
        }

        /// <summary>
        /// Reads the physical terminal serial number.  Membership-access backups are
        /// keyed by this value rather than the terminal IP, because an IP address can
        /// be reused for a different device later.
        /// </summary>
        public bool TryGetDeviceSerialNumber(out string serialNumber)
        {
            serialNumber = string.Empty;
            if (!_isConnected) return false;

            return _zk.GetSerialNumber(_machineNumber, out serialNumber) &&
                   !string.IsNullOrWhiteSpace(serialNumber);
        }

        /// <summary>
        /// Reads an access-control time-zone definition.  A TFT/X990 definition is
        /// 56 digits: seven Sunday-to-Saturday HHmmHHmm ranges.
        /// </summary>
        public bool TryGetTimeZoneDefinition(int timeZoneId, out string definition)
        {
            definition = string.Empty;
            if (!_isConnected) return false;

            return _zk.GetTZInfo(_machineNumber, timeZoneId, ref definition);
        }

        /// <summary>
        /// Writes a global access-control time-zone definition and commits it to the
        /// device.  Callers must read it back after this method succeeds; a COM true
        /// result alone is never treated as proof of the terminal's final state.
        /// </summary>
        public bool SetTimeZoneDefinition(int timeZoneId, string definition)
        {
            if (!_isConnected) return false;

            bool ok = _zk.SetTZInfo(_machineNumber, timeZoneId, definition);
            return ok && _zk.RefreshData(_machineNumber);
        }

        /// <summary>
        /// Reads the TFT/X990 personal/group access-control time-zone string for a
        /// user.  This SDK API accepts an Int32 device user ID even though most other
        /// user APIs accept an enrol-number string.
        /// </summary>
        public bool TryGetUserTimeZones(string enrollNumber, out string timeZones)
        {
            timeZones = string.Empty;
            if (!TryGetUserTimeZoneState(enrollNumber, out UserTimeZoneState state))
                return false;

            timeZones = state.RawTimeZones;
            return true;
        }

        /// <summary>
        /// Reads the raw per-user time-zone BSTR and the terminal's semantic
        /// group/personal selector as one indivisible SDK observation.  On the
        /// X990, UseGroupTimeZone must be invoked immediately after
        /// GetUserTZStr: later COM calls can make the result describe a different
        /// access-control read.  Callers must use this method rather than trying
        /// to infer group-vs-personal meaning from the raw BSTR alone.
        /// </summary>
        public bool TryGetUserTimeZoneState(string enrollNumber, out UserTimeZoneState state)
        {
            state = null;
            if (!_isConnected || !TryParseNumericDeviceUserId(enrollNumber, out int userId))
                return false;

            try
            {
                string rawTimeZones = string.Empty;
                if (!_zk.GetUserTZStr(_machineNumber, userId, ref rawTimeZones))
                    return false;

                // Keep this as the immediately following COM call. In particular,
                // do not insert GetLastError, GetUserGroup, or RefreshData here.
                bool usesGroupTimeZone = _zk.UseGroupTimeZone();
                state = new UserTimeZoneState
                {
                    RawTimeZones = rawTimeZones ?? string.Empty,
                    UsesGroupTimeZone = usesGroupTimeZone
                };
                return true;
            }
            catch
            {
                // Firmware may not expose every access-control COM member. Treat
                // this as an unreadable state; callers will make no mutation.
                state = null;
                return false;
            }
        }

        /// <summary>
        /// Sets the TFT/X990 personal/group access-control time-zone string for one
        /// user, then commits it.  The caller must perform an exact read-back check.
        /// </summary>
        public bool SetUserTimeZones(string enrollNumber, string timeZones)
        {
            if (!_isConnected || !TryParseNumericDeviceUserId(enrollNumber, out int userId))
                return false;

            bool ok = _zk.SetUserTZStr(_machineNumber, userId, timeZones);
            return ok && _zk.RefreshData(_machineNumber);
        }

        public bool TryGetAccessControlFunction(out int accessControlFunction)
        {
            accessControlFunction = 0;
            if (!_isConnected) return false;
            return _zk.GetACFun(ref accessControlFunction);
        }

        /// <summary>
        /// Reads the terminal's effective access-control inputs for one enrolled
        /// person.  This is deliberately diagnostic-only: it invokes only SDK
        /// Get* APIs and never calls Set*, RefreshData, ACUnlock, or any user
        /// mutation API.  It helps determine whether a terminal is using the
        /// person's individual schedule, their access group, or a separate
        /// unlock-group rule.
        /// </summary>
        public AccessControlDiagnosticSnapshot ReadAccessControlDiagnostics(string enrollNumber)
        {
            var snapshot = new AccessControlDiagnosticSnapshot
            {
                EnrollNumber = enrollNumber ?? string.Empty
            };

            if (!_isConnected)
            {
                snapshot.RequestError = "Device is not connected.";
                return snapshot;
            }

            if (!TryParseNumericDeviceUserId(enrollNumber, out int userId))
            {
                snapshot.RequestError = "Enroll Number must be a canonical positive numeric terminal user ID.";
                return snapshot;
            }

            try
            {
                string userTimeZones = string.Empty;
                snapshot.UserTimeZonesRead = _zk.GetUserTZStr(_machineNumber, userId, ref userTimeZones);
                snapshot.UserTimeZones = userTimeZones ?? string.Empty;
                if (!snapshot.UserTimeZonesRead)
                    snapshot.UserTimeZonesErrorCode = GetLastErrorCode();
                else
                {
                    // Keep this as the immediately following COM call. The X990
                    // server exposes the selector as state associated with that
                    // read, not as a standalone per-user query.
                    snapshot.UseGroupTimeZone = _zk.UseGroupTimeZone();
                    snapshot.UseGroupTimeZoneAvailable = true;
                }

                int userGroup = 0;
                snapshot.UserGroupRead = _zk.GetUserGroup(_machineNumber, userId, ref userGroup);
                snapshot.UserGroup = userGroup;
                if (!snapshot.UserGroupRead)
                    snapshot.UserGroupErrorCode = GetLastErrorCode();

                int accessControlFunction = 0;
                snapshot.AccessControlFunctionRead = _zk.GetACFun(ref accessControlFunction);
                snapshot.AccessControlFunction = accessControlFunction;
                if (!snapshot.AccessControlFunctionRead)
                    snapshot.AccessControlFunctionErrorCode = GetLastErrorCode();

                string unlockGroups = string.Empty;
                snapshot.UnlockGroupsRead = _zk.GetUnlockGroups(_machineNumber, ref unlockGroups);
                snapshot.UnlockGroups = unlockGroups ?? string.Empty;
                if (!snapshot.UnlockGroupsRead)
                    snapshot.UnlockGroupsErrorCode = GetLastErrorCode();

                if (snapshot.UserGroupRead)
                {
                    string groupTimeZones = string.Empty;
                    snapshot.GroupTimeZonesRead = _zk.GetGroupTZStr(_machineNumber, userGroup,
                                                                      ref groupTimeZones);
                    snapshot.GroupTimeZones = groupTimeZones ?? string.Empty;
                    if (!snapshot.GroupTimeZonesRead)
                        snapshot.GroupTimeZonesErrorCode = GetLastErrorCode();

                    int timeZone1 = 0;
                    int timeZone2 = 0;
                    int timeZone3 = 0;
                    int validHoliday = 0;
                    int verifyStyle = 0;
                    snapshot.LegacyGroupTimeZonesRead = _zk.SSR_GetGroupTZ(
                        _machineNumber, userGroup, ref timeZone1, ref timeZone2,
                        ref timeZone3, ref validHoliday, ref verifyStyle);
                    snapshot.LegacyGroupTimeZone1 = timeZone1;
                    snapshot.LegacyGroupTimeZone2 = timeZone2;
                    snapshot.LegacyGroupTimeZone3 = timeZone3;
                    snapshot.LegacyGroupValidHoliday = validHoliday;
                    snapshot.LegacyGroupVerifyStyle = verifyStyle;
                    if (!snapshot.LegacyGroupTimeZonesRead)
                        snapshot.LegacyGroupTimeZonesErrorCode = GetLastErrorCode();
                }
            }
            catch (Exception ex)
            {
                // A firmware can expose only part of the access-control API.  A
                // diagnostic must not crash the bridge or change the terminal in
                // that case; retain all values read before the exception.
                snapshot.RequestError = "Read-only access diagnostic stopped: " + ex.Message;
            }

            return snapshot;
        }

        /// <summary>
        /// The X990 time-zone methods require a canonical positive 32-bit numeric
        /// device user ID.  Reject ambiguous IDs (for example "001" or a UUID)
        /// rather than accidentally changing a different user's schedule.
        /// </summary>
        public static bool TryParseNumericDeviceUserId(string enrollNumber, out int userId)
        {
            userId = 0;
            if (string.IsNullOrWhiteSpace(enrollNumber)) return false;

            string trimmed = enrollNumber.Trim();
            if (!int.TryParse(trimmed, NumberStyles.None, CultureInfo.InvariantCulture, out userId) || userId <= 0)
                return false;

            return string.Equals(userId.ToString(CultureInfo.InvariantCulture), trimmed,
                                 StringComparison.Ordinal);
        }

        public bool DeleteUser(string enrollNumber)
        {
            if (!_isConnected) return false;
            // CORRECTED: DeleteUserInfoEx is Black&White-device-only (int userID) and does
            // NOT apply to the X990+ID (TFT/IFACE class). For TFT/IFACE devices the manual
            // (section 5.2.4.5, p.90-91) confirms the correct call is SSR_DeleteEnrollData
            // with backup number 12, which means "delete the user: fingerprints, card, and
            // password". Verified against the manual text, not guessed.
            bool ok = _zk.SSR_DeleteEnrollData(_machineNumber, enrollNumber, 12);
            if (ok) _zk.RefreshData(_machineNumber);
            return ok;
        }

        /// <summary>
        /// This is the exact signature from RTEventsMain.cs's axCZKEM1_OnAttTransactionEx -
        /// copied parameter-for-parameter, not reconstructed from memory.
        /// </summary>
        private void Zk_OnAttTransactionEx(string sEnrollNumber, int iIsInValid, int iAttState,
            int iVerifyMethod, int iYear, int iMonth, int iDay, int iHour, int iMinute, int iSecond,
            int iWorkCode)
        {
            // Never let an application subscriber exception escape back through
            // the vendor COM callback.  Some zkemkeeper builds terminate the host
            // process when that happens.
            try
            {
                var evt = new AttendanceEvent
                {
                    EnrollNumber = sEnrollNumber,
                    IsInvalid = iIsInValid != 0,
                    AttState = iAttState,
                    VerifyMethod = iVerifyMethod,
                    Timestamp = SafeMakeDateTime(iYear, iMonth, iDay, iHour, iMinute, iSecond),
                    WorkCode = iWorkCode
                };

                Action<AttendanceEvent> handler = OnAttendance;
                handler?.Invoke(evt);
            }
            catch (Exception ex)
            {
                RenewalDeskBridge.Program.WriteCrashLog("Biometric COM attendance callback failed", ex);
            }
        }

        private static DateTime SafeMakeDateTime(int y, int mo, int d, int h, int mi, int s)
        {
            try
            {
                return new DateTime(y, mo, d, h, mi, s);
            }
            catch
            {
                // Device clock can occasionally report garbage after a firmware hiccup -
                // don't crash the bridge over a bad timestamp, fall back to "now" and let
                // the raw values still get logged in the event's payload for debugging.
                return DateTime.Now;
            }
        }

        public void Dispose()
        {
            Disconnect();
        }
    }

    public class AttendanceEvent
    {
        public string EnrollNumber { get; set; }
        public bool IsInvalid { get; set; }
        public int AttState { get; set; }
        public int VerifyMethod { get; set; }
        public DateTime Timestamp { get; set; }
        public int WorkCode { get; set; }
    }

    public class DeviceUserProfile
    {
        public string Name { get; set; }
        public int Privilege { get; set; }
        public bool Enabled { get; set; }
    }

    /// <summary>
    /// The terminal's per-user access-control state. RawTimeZones is retained
    /// verbatim for forensic restore, while UsesGroupTimeZone is the semantic
    /// selector that determines whether that raw per-user value is active.
    /// </summary>
    public sealed class UserTimeZoneState
    {
        public string RawTimeZones { get; set; }
        public bool UsesGroupTimeZone { get; set; }
    }

    /// <summary>
    /// Raw, read-only access-control values returned by the eSSL/ZKTeco COM
    /// server.  Do not infer a physical-door decision from one field alone: a
    /// terminal may be configured to use group time zones and/or unlock groups.
    /// </summary>
    public sealed class AccessControlDiagnosticSnapshot
    {
        public string EnrollNumber { get; set; }
        public string RequestError { get; set; }

        public bool UserTimeZonesRead { get; set; }
        public string UserTimeZones { get; set; }
        public int UserTimeZonesErrorCode { get; set; }

        public bool UserGroupRead { get; set; }
        public int UserGroup { get; set; }
        public int UserGroupErrorCode { get; set; }

        public bool UseGroupTimeZone { get; set; }
        public bool UseGroupTimeZoneAvailable { get; set; }

        public bool GroupTimeZonesRead { get; set; }
        public string GroupTimeZones { get; set; }
        public int GroupTimeZonesErrorCode { get; set; }

        public bool LegacyGroupTimeZonesRead { get; set; }
        public int LegacyGroupTimeZone1 { get; set; }
        public int LegacyGroupTimeZone2 { get; set; }
        public int LegacyGroupTimeZone3 { get; set; }
        public int LegacyGroupValidHoliday { get; set; }
        public int LegacyGroupVerifyStyle { get; set; }
        public int LegacyGroupTimeZonesErrorCode { get; set; }

        public bool AccessControlFunctionRead { get; set; }
        public int AccessControlFunction { get; set; }
        public int AccessControlFunctionErrorCode { get; set; }

        public bool UnlockGroupsRead { get; set; }
        public string UnlockGroups { get; set; }
        public int UnlockGroupsErrorCode { get; set; }
    }
}
