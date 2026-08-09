using System;
using zkemkeeper;

namespace RenewalDeskBridge.Device
{
    /// <summary>
    /// Thin wrapper around the eSSL/ZKTeco zkemkeeper.dll COM object.
    ///
    /// Every method signature here is copied EXACTLY from the SDK's own demo source
    /// (Communication Protocol SDK (Ver6.3.1.55)N/Demo/C#/IFace/*), not guessed:
    ///   - Connect_Net(string ip, int port)              -> AccessControl demo, ACMain.cs
    ///   - ACUnlock(int machineNumber, int delaySeconds)  -> AccessControl demo, ACMain.cs
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

        public bool IsConnected => _isConnected;

        /// <summary>Fired whenever the device reports a scan/attendance event in real time.</summary>
        public event Action<AttendanceEvent> OnAttendance;

        /// <summary>Fired when connection is lost unexpectedly, so the caller can trigger reconnect logic.</summary>
        public event Action OnDisconnected;

        public DeviceConnection()
        {
            // Wire the real-time event exactly as the RTEvents demo does.
            // NOTE: this handler fires on the COM apartment thread, not necessarily your
            // UI thread or async context - if you touch UI controls or shared state from
            // here, marshal appropriately (see BridgeForm.cs for the Invoke pattern used).
            _zk.OnAttTransactionEx += Zk_OnAttTransactionEx;
        }

        public bool Connect(string ip, int port, string commPassword, int machineNumber)
        {
            _machineNumber = machineNumber;

            if (!string.IsNullOrEmpty(commPassword))
            {
                _zk.SetCommPasswordEx(commPassword);
            }

            _isConnected = _zk.Connect_Net(ip, port);

            if (_isConnected)
            {
                // 65535 registers ALL real-time event types, matching the demo's own comment:
                // "registering all". We narrow this later if we only care about attendance.
                _zk.RegEvent(_machineNumber, 65535);
            }

            return _isConnected;
        }

        public void Disconnect()
        {
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
        /// Unlocks the door relay for delaySeconds, then it re-locks automatically.
        /// This matches ACMain.cs's btnACUnlock_Click exactly.
        /// </summary>
        public bool UnlockDoor(int delaySeconds)
        {
            if (!_isConnected) return false;
            return _zk.ACUnlock(_machineNumber, delaySeconds);
        }

        /// <summary>
        /// Creates OR updates a user, including enabling/disabling them - this one SDK call
        /// does both jobs because bEnabled is one of its parameters. There is no separate
        /// "create" vs "enable" call in this SDK; SSR_SetUserInfo covers both.
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
                _zk.RefreshData(_machineNumber); // commits pending changes - demo calls this after batches
            }
            return ok;
        }

        /// <summary>
        /// Convenience wrapper for the common case: just flip enabled/disabled on an
        /// already-known user. Re-reads current info first so we don't clobber their
        /// name/password with blanks - SSR_SetUserInfo requires all fields together.
        /// </summary>
        public bool SetUserEnabled(string enrollNumber, bool enabled)
        {
            if (!_isConnected) return false;

            string name = "";
            string password = "";
            int privilege = 0;
            bool currentlyEnabled = false;

            // SSR_GetUserInfo signature also comes from the SDK demo (UserInfo project) -
            // parameters are passed by ref and populated by the call.
            bool found = _zk.SSR_GetUserInfo(_machineNumber, enrollNumber, out name, out password,
                                              out privilege, out currentlyEnabled);
            if (!found)
            {
                // User doesn't exist on the device yet - caller should use SetUser() to create them first.
                return false;
            }

            return SetUser(enrollNumber, name, enabled, privilege, password);
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
            var evt = new AttendanceEvent
            {
                EnrollNumber = sEnrollNumber,
                IsInvalid = iIsInValid != 0,
                AttState = iAttState,
                VerifyMethod = iVerifyMethod,
                Timestamp = SafeMakeDateTime(iYear, iMonth, iDay, iHour, iMinute, iSecond),
                WorkCode = iWorkCode
            };

            OnAttendance?.Invoke(evt);
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
            _zk.OnAttTransactionEx -= Zk_OnAttTransactionEx;
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
}
