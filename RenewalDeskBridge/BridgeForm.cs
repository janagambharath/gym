using System;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using RenewalDeskBridge.AccessControl;
using RenewalDeskBridge.CloudApi;
using RenewalDeskBridge.Config;
using RenewalDeskBridge.Device;
using RenewalDeskBridge.Queue;

namespace RenewalDeskBridge
{
    /// <summary>
    /// The visible window for the dev/test phase. Shows connection status for both
    /// the device and the cloud API, a live event log, and manual test buttons for
    /// the exact behaviors we need to prove: unlock, enable, disable, attendance.
    ///
    /// This is intentionally NOT a Windows Service yet - during testing you want to
    /// SEE what's happening. Converting this to a headless service for the permanent
    /// bridge PC is a later, separate step once this is proven against real hardware.
    /// </summary>
    public partial class BridgeForm : Form
    {
        private readonly BridgeConfig _config;
        private readonly DeviceConnection _device = new DeviceConnection();
        private readonly LocalOutbox _outbox = new LocalOutbox();
        private readonly AccessStateStore _accessState = new AccessStateStore();
        private readonly MembershipAccessService _membershipAccess;
        // The device event handler and retry loop can both request an attendance
        // flush.  Serialize them so one local event is not posted twice in parallel.
        private readonly SemaphoreSlim _attendanceFlushLock = new SemaphoreSlim(1, 1);
        private RenewalDeskClient _api;
        private string _connectedDeviceSerial = string.Empty;
        private bool _attendanceHandlerRegistered;
        private readonly bool _x990AccessTestMode;

        private CancellationTokenSource _cts;

        public BridgeForm(bool x990AccessTestMode = false)
        {
            InitializeComponent();
            _x990AccessTestMode = x990AccessTestMode;
            _config = BridgeConfig.Load();
            _membershipAccess = new MembershipAccessService(_device, _accessState, _config);
            LoadConfigIntoFields();
            UpdateMembershipPolicyStatus();

            // The production X990 currently crashes in its COM callback path, so
            // attendance capture is deliberately disabled for this commissioning
            // build. It has no bearing on fingerprint verification or door access.
            if (_config.EnableLiveAttendanceEvents)
            {
                _device.OnAttendance += Device_OnAttendance;
                _attendanceHandlerRegistered = true;
            }

            // The advanced diagnostic uses several optional access-control COM
            // APIs. The client's firmware exits natively when they are invoked,
            // before .NET can catch or log the error. Hide it rather than let an
            // operator accidentally trigger another crash.
            btnDiagnoseAccess.Visible = false;

            // A package-provided shortcut explicitly starts a supervised X990
            // test.  The regular production launch can poll online membership
            // commands only when the local config has been deliberately enabled
            // after this physical-door test.
            btnTestEnable.Visible = _x990AccessTestMode;
            btnTestDisable.Visible = _x990AccessTestMode;
            btnPrepareDenyTimeZone.Visible = _x990AccessTestMode;
            btnMarkPhysicalTestPassed.Visible = _x990AccessTestMode;
            // Enrollment confirmation is intentionally available in both modes:
            // it only binds an already-enrolled, normal terminal user to an
            // online member after an operator checks the displayed identity.
            // It never creates/deletes a fingerprint or changes access on its own.
            btnConfirmEnrollment.Visible = true;
            txtTestEnrollNumber.Visible = true;
            lblTestEnrollNumber.Visible = true;
            txtTestMemberName.Visible = true;
            lblTestMemberName.Visible = true;
            btnTestUnlock.Visible = _x990AccessTestMode;
            txtUnlockDelay.Visible = _x990AccessTestMode;
            lblUnlockDelay.Visible = _x990AccessTestMode;

            if (_x990AccessTestMode)
            {
                grpTests.Text = "3. X990 controlled access test (cloud commands OFF)";
            }
            else
            {
                grpTests.Text = "3. Biometric member enrolment";
                lblTestEnrollNumber.Text = "Terminal Enrol Number:";
            }
        }

        private void LoadConfigIntoFields()
        {
            txtDeviceIp.Text = _config.DeviceIp;
            txtDevicePort.Text = _config.DevicePort.ToString();
            txtCommPassword.Text = _config.DeviceCommPassword;
            txtGymId.Text = _config.GymId;
            txtApiBaseUrl.Text = _config.ApiBaseUrl;
            txtApiKey.Text = _config.ApiKey;
            txtDenyTimeZoneId.Text = _config.MembershipDenyTimeZoneId.ToString();
        }

        private void SaveFieldsIntoConfig()
        {
            _config.DeviceIp = txtDeviceIp.Text.Trim();
            _config.DevicePort = int.TryParse(txtDevicePort.Text.Trim(), out int p) ? p : 4370;
            _config.DeviceCommPassword = txtCommPassword.Text.Trim();
            _config.GymId = txtGymId.Text.Trim();
            _config.ApiBaseUrl = txtApiBaseUrl.Text.Trim();
            _config.ApiKey = txtApiKey.Text.Trim();
            if (int.TryParse(txtDenyTimeZoneId.Text.Trim(), out int denyTimeZoneId))
            {
                // Once a policy has been prepared, changing the textbox must not
                // silently point existing backups at a different global terminal slot.
                if (!_config.MembershipAccessPolicyPrepared ||
                    denyTimeZoneId == _config.MembershipDenyTimeZoneId)
                {
                    _config.MembershipDenyTimeZoneId = denyTimeZoneId;
                }
                else
                {
                    txtDenyTimeZoneId.Text = _config.MembershipDenyTimeZoneId.ToString();
                }
            }
            _config.Save();
        }

        // ---------- Connect / Disconnect ----------

        private void btnConnect_Click(object sender, EventArgs e)
        {
            SaveFieldsIntoConfig();

            if (_device.IsConnected)
            {
                _cts?.Cancel();
                _api = null;
                _connectedDeviceSerial = string.Empty;
                _device.Disconnect();
                btnConnect.Text = "Connect";
                UpdateDeviceStatus(false);
                UpdateApiStatus(false);
                Log("Disconnected from device.");
                UpdateMembershipPolicyStatus();
                return;
            }

            if (string.IsNullOrWhiteSpace(_config.DeviceIp))
            {
                MessageBox.Show("Please enter the device IP address first.", "Missing IP");
                return;
            }

            bool ok = _device.Connect(_config.DeviceIp, _config.DevicePort,
                                       _config.DeviceCommPassword, _config.MachineNumber,
                                       _config.EnableLiveAttendanceEvents);
            UpdateDeviceStatus(ok);

            if (ok)
            {
                Log($"Connected to device at {_config.DeviceIp}:{_config.DevicePort}.");
                btnConnect.Text = "Disconnect";
                if (_device.TryGetDeviceSerialNumber(out string deviceSerial))
                {
                    _connectedDeviceSerial = deviceSerial.Trim();
                    Log($"Device serial: {_connectedDeviceSerial}");
                }
                else
                {
                    Log("WARNING: Could not read the device serial. Online Renewal Desk connection is locked.");
                }

                if (!_config.EnableLiveAttendanceEvents)
                {
                    Log("Live attendance scan capture is OFF for stability during commissioning.");
                }

                if (!CloudCommandPollingEnabled)
                {
                    Log(_x990AccessTestMode
                        ? "Cloud command polling is OFF for this supervised X990 test."
                        : "Cloud command polling is OFF during X990 stability commissioning. " +
                          "The Bridge sends online heartbeats only; it will not change device users or schedules.");
                    if (_x990AccessTestMode)
                    {
                        Log("Only buttons clicked by the on-site operator can change one test user's access schedule.");
                    }
                }

                if (!TryStartCloudConnection())
                {
                    UpdateApiStatus(false);
                }
                UpdateMembershipPolicyStatus();
            }
            else
            {
                int errCode = _device.GetLastErrorCode();
                Log($"FAILED to connect. Device error code: {errCode}. " +
                    "Check: is the IP correct? Is the Ethernet cable plugged in? " +
                    "Is this PC on the same network as the device?");
            }
        }

        private bool TryStartCloudConnection()
        {
            if (string.IsNullOrWhiteSpace(_connectedDeviceSerial))
            {
                Log("Renewal Desk not started: read the terminal serial first, then create a matching bridge credential.");
                return false;
            }
            if (string.IsNullOrWhiteSpace(_config.GymId) || string.IsNullOrWhiteSpace(_config.ApiKey))
            {
                Log("Renewal Desk not started: enter the backend-issued Bridge ID and API key, then reconnect.");
                return false;
            }
            if (!Uri.TryCreate(_config.ApiBaseUrl, UriKind.Absolute, out Uri apiUri) ||
                (apiUri.Scheme != Uri.UriSchemeHttps &&
                 !string.Equals(apiUri.Host, "localhost", StringComparison.OrdinalIgnoreCase) &&
                 !string.Equals(apiUri.Host, "127.0.0.1", StringComparison.OrdinalIgnoreCase)))
            {
                Log("Renewal Desk not started: enter a valid HTTPS API URL (HTTP is allowed only for localhost mock testing).");
                return false;
            }

            _api = new RenewalDeskClient(apiUri.GetLeftPart(UriPartial.Authority), _config.ApiKey,
                                         _config.GymId, _connectedDeviceSerial);
            _cts = new CancellationTokenSource();
            StartBackgroundLoops(_cts.Token);
            return true;
        }

        private void UpdateDeviceStatus(bool connected)
        {
            lblDeviceStatus.Text = connected ? "Device: Connected" : "Device: Not connected";
            lblDeviceStatus.ForeColor = connected
                ? System.Drawing.Color.DarkGreen
                : System.Drawing.Color.DarkRed;
        }

        private void UpdateApiStatus(bool connected)
        {
            lblApiStatus.Text = connected ? "Renewal Desk: Connected" : "Renewal Desk: Not connected";
            lblApiStatus.ForeColor = connected
                ? System.Drawing.Color.DarkGreen
                : System.Drawing.Color.DarkRed;
        }

        private void UpdateMembershipPolicyStatus()
        {
            if (!CloudCommandPollingEnabled)
            {
                lblMembershipPolicyStatus.Text = _x990AccessTestMode
                    ? "X990 controlled test mode: cloud commands are OFF; only supervised manual testing is available."
                    : "Commissioning mode: cloud membership commands are OFF — no device access changes can run.";
                lblMembershipPolicyStatus.ForeColor = System.Drawing.Color.DarkOrange;
                return;
            }

            lblMembershipPolicyStatus.Text = _membershipAccess == null
                ? "Expiry policy: loading..."
                : _membershipAccess.DescribePolicyStatus();

            if (_config != null && _config.MembershipAccessPolicyPhysicallyVerified)
                lblMembershipPolicyStatus.ForeColor = System.Drawing.Color.DarkGreen;
            else if (_config != null && _config.MembershipAccessPolicyPrepared)
                lblMembershipPolicyStatus.ForeColor = System.Drawing.Color.DarkOrange;
            else
                lblMembershipPolicyStatus.ForeColor = System.Drawing.Color.DarkRed;
        }

        // ---------- Manual test buttons ----------

        private void btnTestUnlock_Click(object sender, EventArgs e)
        {
            if (!_device.IsConnected)
            {
                MessageBox.Show("Connect to the device first.", "Not connected");
                return;
            }

            int delay = int.TryParse(txtUnlockDelay.Text.Trim(), out int d) ? d : 5;
            bool ok = _device.UnlockDoor(delay);
            Log(ok ? $"Door unlock command sent (delay {delay}s)." : "Unlock FAILED - check device connection.");
        }

        private void btnTestEnable_Click(object sender, EventArgs e)
        {
            RunTestUserToggle(enabled: true);
        }

        private void btnTestDisable_Click(object sender, EventArgs e)
        {
            RunTestUserToggle(enabled: false);
        }

        private void btnDiagnoseAccess_Click(object sender, EventArgs e)
        {
            // Intentionally left inert in the X990 stability build. This handler
            // remains only because it is wired by the designer in older copies.
            MessageBox.Show(
                "Advanced access diagnostics are disabled for this terminal because its SDK crashes on " +
                "those optional queries. No device setting was changed.",
                "Diagnostic unavailable", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        private void LogAccessControlDiagnostic(AccessControlDiagnosticSnapshot diagnostic)
        {
            Log("ACCESS DIAGNOSTIC for user " + diagnostic.EnrollNumber +
                " (read-only; no terminal settings were changed):");

            if (!string.IsNullOrWhiteSpace(diagnostic.RequestError))
            {
                Log("  Diagnostic note: " + diagnostic.RequestError);
                return;
            }

            Log("  User TZ (GetUserTZStr): " +
                DescribeDiagnosticRead(diagnostic.UserTimeZonesRead, diagnostic.UserTimeZones,
                                       diagnostic.UserTimeZonesErrorCode));
            Log("  User access group (GetUserGroup): " +
                DescribeDiagnosticRead(diagnostic.UserGroupRead,
                                       diagnostic.UserGroup.ToString(),
                                       diagnostic.UserGroupErrorCode));
            Log("  Use group time zones (UseGroupTimeZone): " +
                (diagnostic.UseGroupTimeZoneAvailable
                    ? (diagnostic.UseGroupTimeZone ? "ON" : "OFF")
                    : "NOT AVAILABLE (GetUserTZStr failed)"));
            Log("  Access-control function (GetACFun): " +
                DescribeDiagnosticRead(diagnostic.AccessControlFunctionRead,
                                       diagnostic.AccessControlFunction.ToString(),
                                       diagnostic.AccessControlFunctionErrorCode));
            Log("  Unlock groups (GetUnlockGroups): " +
                DescribeDiagnosticRead(diagnostic.UnlockGroupsRead, diagnostic.UnlockGroups,
                                       diagnostic.UnlockGroupsErrorCode));

            if (diagnostic.UserGroupRead)
            {
                Log("  Group " + diagnostic.UserGroup + " TZ (GetGroupTZStr): " +
                    DescribeDiagnosticRead(diagnostic.GroupTimeZonesRead,
                                           diagnostic.GroupTimeZones,
                                           diagnostic.GroupTimeZonesErrorCode));
                Log("  Group " + diagnostic.UserGroup + " TZ (SSR_GetGroupTZ): " +
                    DescribeDiagnosticRead(
                        diagnostic.LegacyGroupTimeZonesRead,
                        diagnostic.LegacyGroupTimeZone1 + ":" +
                        diagnostic.LegacyGroupTimeZone2 + ":" +
                        diagnostic.LegacyGroupTimeZone3 + ":" +
                        "ValidHoliday=" + diagnostic.LegacyGroupValidHoliday + ", " +
                        "VerifyStyle=" + diagnostic.LegacyGroupVerifyStyle,
                        diagnostic.LegacyGroupTimeZonesErrorCode));
            }

            if (diagnostic.UserGroupRead && diagnostic.UseGroupTimeZoneAvailable &&
                diagnostic.UseGroupTimeZone)
            {
                Log("  Diagnostic hint: group time zones are ON, so this user's personal TZ may not control the door.");
            }
            else if (diagnostic.UserGroupRead && diagnostic.UseGroupTimeZoneAvailable)
            {
                Log("  Diagnostic hint: group time zones are OFF; compare the user TZ with access-control and unlock-group settings.");
            }
        }

        private static string DescribeDiagnosticRead(bool readSucceeded, string value, int errorCode)
        {
            if (!readSucceeded)
                return "FAILED (SDK error " + errorCode + ")";

            return "'" + (value ?? string.Empty) + "'";
        }

        private void btnPrepareDenyTimeZone_Click(object sender, EventArgs e)
        {
            if (!_x990AccessTestMode)
            {
                MessageBox.Show("This action is available only from the supervised X990 access-test shortcut.",
                                "Commissioning mode");
                return;
            }

            if (!_device.IsConnected)
            {
                MessageBox.Show("Connect to the device first.", "Not connected");
                return;
            }

            if (!int.TryParse(txtDenyTimeZoneId.Text.Trim(), out int timeZoneId))
            {
                MessageBox.Show("Enter a whole-number time-zone ID from 2 to 50.", "Invalid time zone");
                return;
            }

            var confirmation = MessageBox.Show(
                "This changes one global access-control time-zone on the terminal.\r\n\r\n" +
                "Continue only if the gym owner has confirmed that time-zone #" + timeZoneId +
                " is unused by every user and group. Never use #1.\r\n\r\n" +
                "The bridge will back up the current definition before changing it.",
                "Confirm unused terminal time zone", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);

            if (confirmation != DialogResult.Yes) return;

            MembershipAccessResult result = _membershipAccess.PrepareDenyTimeZone(timeZoneId, ownerConfirmedUnused: true);
            Log(result.Message);
            if (result.Success)
            {
                txtDenyTimeZoneId.Text = _config.MembershipDenyTimeZoneId.ToString();
                UpdateMembershipPolicyStatus();
            }
        }

        private void btnMarkPhysicalTestPassed_Click(object sender, EventArgs e)
        {
            if (!_x990AccessTestMode)
            {
                MessageBox.Show("This action is available only from the supervised X990 access-test shortcut.",
                                "Commissioning mode");
                return;
            }

            if (!_device.IsConnected)
            {
                MessageBox.Show("Connect to the device first.", "Not connected");
                return;
            }

            var confirmation = MessageBox.Show(
                "Click Yes only after a safe non-admin enrolled member was assigned to the deny rule " +
                "and their fingerprint was physically rejected at this door.\r\n\r\n" +
                "A scan log or a successful device read-back is not enough.",
                "Confirm physical-door test", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);

            if (confirmation != DialogResult.Yes) return;

            MembershipAccessResult result = _membershipAccess.MarkPhysicalTestPassed();
            Log(result.Message);
            UpdateMembershipPolicyStatus();
        }

        private void RunTestUserToggle(bool enabled)
        {
            if (!_x990AccessTestMode)
            {
                MessageBox.Show("This action is available only from the supervised X990 access-test shortcut.",
                                "Commissioning mode");
                return;
            }

            if (!_device.IsConnected)
            {
                MessageBox.Show("Connect to the device first.", "Not connected");
                return;
            }

            string enrollNumber = txtTestEnrollNumber.Text.Trim();
            if (string.IsNullOrEmpty(enrollNumber))
            {
                MessageBox.Show("Enter a test Enroll Number (the ID this member is registered " +
                                 "under on the fingerprint device).", "Missing Enroll Number");
                return;
            }

            if (!enabled)
            {
                var confirmation = MessageBox.Show(
                    "This assigns an all-day deny access schedule to one member. It does not delete " +
                    "fingerprints, but the member may be refused at the door until you restore them.\r\n\r\n" +
                    "Use only a safe non-admin test member and keep someone at the door. Continue?",
                    "Confirm membership expiry test", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
                if (confirmation != DialogResult.Yes) return;
            }

            MembershipAccessResult result = enabled
                ? _membershipAccess.RestoreMembershipAccess(enrollNumber)
                : _membershipAccess.DisableMembershipAccess(enrollNumber, allowUnverifiedTest: true);

            Log(result.Message);
            UpdateMembershipPolicyStatus();
        }

        private async void btnConfirmEnrollment_Click(object sender, EventArgs e)
        {
            if (!_device.IsConnected)
            {
                MessageBox.Show("Connect to the biometric device first.", "Not connected");
                return;
            }
            if (_api == null)
            {
                MessageBox.Show(
                    "Connect with the backend-issued Bridge ID and API key first.",
                    "Renewal Desk not connected");
                return;
            }

            string memberId = txtTestMemberName.Text.Trim();
            string enrollNumber = txtTestEnrollNumber.Text.Trim();
            if (!int.TryParse(memberId, out int parsedMemberId) || parsedMemberId <= 0)
            {
                MessageBox.Show("Enter the numeric Renewal Desk Member ID shown on the member profile.",
                                "Missing Member ID");
                return;
            }
            if (!DeviceConnection.TryParseNumericDeviceUserId(enrollNumber, out int ignoredUserId))
            {
                MessageBox.Show("Enter the exact canonical numeric Enroll Number from the terminal.",
                                "Invalid Enroll Number");
                return;
            }
            if (!_device.TryGetUserProfile(enrollNumber, out DeviceUserProfile profile))
            {
                Log($"Enrollment confirmation failed: terminal user {enrollNumber} could not be read. " +
                    "Enroll the member fingerprint on the terminal first.");
                return;
            }
            if (profile.Privilege != 0)
            {
                Log($"Enrollment confirmation refused: terminal user {enrollNumber} has administrator privilege.");
                return;
            }

            var confirmation = MessageBox.Show(
                "The terminal user was read back successfully.\r\n\r\n" +
                "Renewal Desk Member ID: " + parsedMemberId + "\r\n" +
                "Terminal Enroll Number: " + enrollNumber + "\r\n" +
                "Terminal user name: " + (profile.Name ?? string.Empty) + "\r\n\r\n" +
                "Continue only after confirming that this exact member's fingerprint was enrolled under this number. " +
                "This does not create, replace, or delete any biometric template.",
                "Confirm biometric-member binding", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
            if (confirmation != DialogResult.Yes) return;

            bool confirmed = await _api.ConfirmEnrollmentAsync(
                parsedMemberId.ToString(), enrollNumber, profile.Name ?? string.Empty);
            Log(confirmed
                ? $"Enrollment confirmed: Renewal Desk member {parsedMemberId} is bound to terminal user {enrollNumber}."
                : $"Enrollment confirmation was rejected by Renewal Desk for member {parsedMemberId}. " +
                  "Check the Member ID, terminal serial, and whether this Enroll Number was already assigned.");
        }

        // ---------- Real-time attendance ----------

        private void Device_OnAttendance(AttendanceEvent evt)
        {
            // This fires on a COM callback thread.  Do not use synchronous Invoke:
            // a terminal event arriving while Windows is closing/repainting the form
            // must not be able to take down the customer-side bridge process.
            if (evt == null || IsDisposed || Disposing || !IsHandleCreated)
                return;

            try
            {
                if (InvokeRequired)
                {
                    BeginInvoke(new Action<AttendanceEvent>(HandleAttendanceOnUi), evt);
                }
                else
                {
                    HandleAttendanceOnUi(evt);
                }
            }
            catch (Exception ex)
            {
                Program.WriteCrashLog("Could not marshal biometric attendance callback", ex);
            }
        }

        private void HandleAttendanceOnUi(AttendanceEvent evt)
        {
            if (evt == null || IsDisposed || Disposing) return;

            try
            {
                Log($"SCAN: EnrollNumber={evt.EnrollNumber}, Time={evt.Timestamp:yyyy-MM-dd HH:mm:ss}, " +
                    $"VerifyMethod={evt.VerifyMethod}, Invalid={evt.IsInvalid}");

                // Buffer locally first - this is the step that makes attendance survive an
                // internet outage. We attempt an immediate push after, but the buffer write
                // happens regardless of whether that push succeeds.
                _outbox.Enqueue(evt.EnrollNumber, evt.Timestamp, evt.VerifyMethod, evt.IsInvalid);

                // Observe failures explicitly instead of allowing a faulted task to
                // disappear without a diagnostic on the gym laptop.
                ObserveBackgroundTask(TryPushSingleEventAsync(), "immediate attendance upload");
            }
            catch (Exception ex)
            {
                Program.WriteCrashLog("Could not process biometric attendance callback", ex);
                Log("Attendance was not uploaded due to a local error. Details were saved in bridge-crash.log.");
            }
        }

        private async Task TryPushSingleEventAsync()
        {
            await FlushAttendanceAsync(limit: 1);
        }

        private async Task FlushAttendanceAsync(int limit)
        {
            // Disconnect can clear _api while an attendance upload is waiting for
            // the local SQLite gate. Retain one client instance for this flush so
            // a normal reconnect cannot turn a scan into a NullReferenceException.
            RenewalDeskClient api = _api;
            if (api == null) return;

            await _attendanceFlushLock.WaitAsync();
            try
            {
                var unsent = _outbox.GetUnsent(limit);
                foreach (var row in unsent)
                {
                    bool sent = await api.SendAttendanceAsync(CreateAttendanceDto(row));
                    if (sent) _outbox.MarkSent(row.Id);
                }
            }
            finally
            {
                _attendanceFlushLock.Release();
            }
        }

        private AttendanceEventDto CreateAttendanceDto(OutboxRow row)
        {
            return new AttendanceEventDto
            {
                EventId = row.EventId,
                GymId = _config.GymId,
                DeviceEnrollNumber = row.EnrollNumber,
                EventTime = row.EventTime,
                VerifyMethod = row.VerifyMethod,
                IsInvalid = row.IsInvalid
            };
        }

        // ---------- Background loops: heartbeat, command poll, retry flush ----------

        private void StartBackgroundLoops(CancellationToken token)
        {
            ObserveBackgroundTask(HeartbeatLoopAsync(token), "Renewal Desk heartbeat loop");
            if (CloudCommandPollingEnabled)
            {
                ObserveBackgroundTask(CommandPollLoopAsync(token), "Renewal Desk command poll loop");
            }
            if (_config.EnableLiveAttendanceEvents)
            {
                ObserveBackgroundTask(RetryFlushLoopAsync(token), "attendance retry loop");
            }
        }

        private bool CloudCommandPollingEnabled
        {
            get { return _config != null && _config.EnableCloudCommandPolling && !_x990AccessTestMode; }
        }

        private void ObserveBackgroundTask(Task task, string operation)
        {
            if (task == null) return;
            task.ContinueWith(t =>
            {
                try
                {
                    Exception error = t.Exception == null ? null : t.Exception.GetBaseException();
                    Program.WriteCrashLog(operation + " stopped unexpectedly", error);
                    RunOnUi(() => Log(operation + " stopped unexpectedly. Details were saved in bridge-crash.log."));
                }
                catch (Exception ex)
                {
                    Program.WriteCrashLog("Could not report a failed background task", ex);
                }
            }, CancellationToken.None,
               TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously,
               TaskScheduler.Default);
        }

        private async Task HeartbeatLoopAsync(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                try
                {
                    RenewalDeskClient api = _api;
                    if (api == null) return;

                    bool ok = await api.SendHeartbeatAsync(_device.IsConnected ? "online" : "device_disconnected");
                    RunOnUi(() =>
                    {
                        UpdateApiStatus(ok);
                        if (!ok && !string.IsNullOrWhiteSpace(api.LastError))
                        {
                            Log($"Renewal Desk heartbeat failed: {api.LastError}");
                        }
                    });
                }
                catch (Exception ex)
                {
                    Program.WriteCrashLog("Renewal Desk heartbeat iteration failed", ex);
                    RunOnUi(() => Log("Renewal Desk heartbeat error. Details were saved in bridge-crash.log."));
                }
                try { await Task.Delay(TimeSpan.FromSeconds(_config.HeartbeatIntervalSeconds), token); }
                catch (TaskCanceledException) { break; }
            }
        }

        private async Task CommandPollLoopAsync(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                try
                {
                    RenewalDeskClient api = _api;
                    if (api == null) return;
                    var commands = await api.GetPendingCommandsAsync();
                    foreach (var cmd in commands)
                    {
                        await ProcessPendingCommandAsync(cmd, api);
                    }
                }
                catch (Exception ex)
                {
                    Program.WriteCrashLog("Renewal Desk command poll iteration failed", ex);
                    RunOnUi(() => Log($"Command poll error: {ex.Message}"));
                }

                try { await Task.Delay(TimeSpan.FromSeconds(_config.CommandPollIntervalSeconds), token); }
                catch (TaskCanceledException) { break; }
            }
        }

        private async Task ProcessPendingCommandAsync(PendingCommand cmd, RenewalDeskClient api)
        {
            if (cmd == null)
            {
                RunOnUi(() => Log("Received an empty command record; it was ignored."));
                return;
            }

            if (string.IsNullOrWhiteSpace(cmd.Id))
            {
                RunOnUi(() => Log("Received a command without an ID; it was not executed."));
                return;
            }

            // The production API always leases a command before returning it.  Refuse
            // an unleased command because we would have no way to prove that our ACK
            // belongs to the current delivery.
            if (string.IsNullOrWhiteSpace(cmd.LeaseToken))
            {
                RunOnUi(() => Log($"Command {cmd.Id} was missing its lease token and was not executed."));
                return;
            }

            CommandReceipt receipt;
            bool isRedelivery = _outbox.TryGetCommandReceipt(cmd.Id, out receipt);

            if (!isRedelivery)
            {
                CommandExecutionResult result = ExecuteCommand(cmd);
                receipt = new CommandReceipt
                {
                    CommandId = cmd.Id,
                    CommandType = cmd.CommandType,
                    EnrollNumber = cmd.EnrollNumber,
                    Status = result.Success ? "acked" : "failed",
                    ResultMessage = result.Message,
                    LeaseToken = cmd.LeaseToken,
                    CompletedAtUtc = DateTime.UtcNow
                };

                // Persist the device outcome before contacting the API.  If the ACK
                // is lost or this PC restarts, a redelivery will reuse this receipt
                // instead of repeating a physical access-control operation.
                if (!_outbox.TryRecordCommandReceipt(receipt))
                {
                    if (!_outbox.TryGetCommandReceipt(cmd.Id, out receipt))
                    {
                        throw new InvalidOperationException(
                            "Could not save or retrieve the local receipt for command " + cmd.Id + ".");
                    }
                    isRedelivery = true;
                }
            }

            bool acked = await api.AckCommandAsync(cmd.Id, receipt.Status, receipt.ResultMessage,
                                                   cmd.LeaseToken);
            RunOnUi(() =>
            {
                string outcome = receipt.Status == "acked" ? "OK" : "FAILED";
                string retryNote = acked
                    ? "ACK sent."
                    : "ACK not confirmed; the saved receipt will prevent duplicate execution on redelivery.";
                string duplicateNote = isRedelivery ? " Redelivery was not re-executed." : string.Empty;
                Log($"Command {cmd.CommandType} for {cmd.EnrollNumber}: {outcome} - " +
                    (receipt.ResultMessage ?? string.Empty) + duplicateNote + " " + retryNote);
            });
        }

        private CommandExecutionResult ExecuteCommand(PendingCommand cmd)
        {
            switch (cmd.CommandType)
            {
                case "enable_user":
                    // For a just-confirmed, already-active terminal user there
                    // is no local deny backup yet.  The service acknowledges that
                    // safe initial baseline without guessing or overwriting the
                    // terminal's existing access schedule.
                    return FromMembershipResult(_membershipAccess.RestoreMembershipAccess(
                        cmd.EnrollNumber, allowInitialActiveNoOp: true));
                case "disable_user":
                    return FromMembershipResult(_membershipAccess.DisableMembershipAccess(cmd.EnrollNumber,
                                                                                            allowUnverifiedTest: false));
                case "create_user":
                    return FromDeviceResult(_device.SetUser(cmd.EnrollNumber, cmd.MemberName ?? "Member", true),
                                            "User profile was created or updated.");
                case "delete_user":
                    return FromDeviceResult(_device.DeleteUser(cmd.EnrollNumber), "User profile was deleted.");
                case "unlock_door":
                    return FromDeviceResult(_device.UnlockDoor(cmd.DelaySeconds ?? 5), "Door unlock command was sent.");
                default:
                    return CommandExecutionResult.Fail("Unknown command type.");
            }
        }

        private CommandExecutionResult FromMembershipResult(MembershipAccessResult result)
        {
            return result.Success
                ? CommandExecutionResult.Ok(result.Message)
                : CommandExecutionResult.Fail(result.Message);
        }

        private CommandExecutionResult FromDeviceResult(bool success, string successMessage)
        {
            return success
                ? CommandExecutionResult.Ok(successMessage)
                : CommandExecutionResult.Fail("The biometric device rejected the command. Error code: " +
                                              _device.GetLastErrorCode() + ".");
        }

        private async Task RetryFlushLoopAsync(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                try
                {
                    await FlushAttendanceAsync(limit: 50);
                }
                catch (Exception ex)
                {
                    Program.WriteCrashLog("Attendance retry iteration failed", ex);
                    RunOnUi(() => Log($"Retry flush error: {ex.Message}"));
                }

                try { await Task.Delay(TimeSpan.FromSeconds(_config.RetryFlushIntervalSeconds), token); }
                catch (TaskCanceledException) { break; }
            }
        }

        // ---------- Logging helpers ----------

        private void Log(string message)
        {
            if (IsDisposed || Disposing || !IsHandleCreated) return;

            try
            {
                if (InvokeRequired)
                {
                    BeginInvoke(new Action<string>(Log), message);
                    return;
                }
                txtLog.AppendText($"[{DateTime.Now:HH:mm:ss}] {message}{Environment.NewLine}");
            }
            catch (Exception ex)
            {
                Program.WriteCrashLog("Could not write to the Bridge live log", ex);
            }
        }

        private void RunOnUi(Action action)
        {
            if (action == null || IsDisposed || Disposing || !IsHandleCreated) return;

            try
            {
                if (InvokeRequired)
                {
                    BeginInvoke(new Action(() =>
                    {
                        if (IsDisposed || Disposing) return;
                        try
                        {
                            action();
                        }
                        catch (Exception ex)
                        {
                            Program.WriteCrashLog("Bridge background UI update failed", ex);
                        }
                    }));
                }
                else action();
            }
            catch (Exception ex)
            {
                Program.WriteCrashLog("Could not marshal a Bridge background update to the window", ex);
            }
        }

        private void BridgeForm_FormClosing(object sender, FormClosingEventArgs e)
        {
            _cts?.Cancel();
            if (_attendanceHandlerRegistered)
            {
                _device.OnAttendance -= Device_OnAttendance;
                _attendanceHandlerRegistered = false;
            }
            _device.Dispose();
        }

        private sealed class CommandExecutionResult
        {
            public bool Success { get; private set; }
            public string Message { get; private set; }

            public static CommandExecutionResult Ok(string message)
            {
                return new CommandExecutionResult { Success = true, Message = message };
            }

            public static CommandExecutionResult Fail(string message)
            {
                return new CommandExecutionResult { Success = false, Message = message };
            }
        }
    }
}
