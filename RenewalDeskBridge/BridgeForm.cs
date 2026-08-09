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
        private RenewalDeskClient _api;

        private CancellationTokenSource _cts;

        public BridgeForm()
        {
            InitializeComponent();
            _config = BridgeConfig.Load();
            _membershipAccess = new MembershipAccessService(_device, _accessState, _config);
            LoadConfigIntoFields();
            UpdateMembershipPolicyStatus();

            _device.OnAttendance += Device_OnAttendance;
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
                _device.Disconnect();
                btnConnect.Text = "Connect";
                UpdateDeviceStatus(false);
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
                                       _config.DeviceCommPassword, _config.MachineNumber);
            UpdateDeviceStatus(ok);

            if (ok)
            {
                Log($"Connected to device at {_config.DeviceIp}:{_config.DevicePort}.");
                btnConnect.Text = "Disconnect";

                _api = new RenewalDeskClient(_config.ApiBaseUrl, _config.ApiKey, _config.GymId);
                _cts = new CancellationTokenSource();
                StartBackgroundLoops(_cts.Token);
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

        private void btnPrepareDenyTimeZone_Click(object sender, EventArgs e)
        {
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

        // ---------- Real-time attendance ----------

        private void Device_OnAttendance(AttendanceEvent evt)
        {
            // This fires on the COM thread - marshal to the UI thread before touching controls.
            if (InvokeRequired)
            {
                Invoke(new Action<AttendanceEvent>(Device_OnAttendance), evt);
                return;
            }

            Log($"SCAN: EnrollNumber={evt.EnrollNumber}, Time={evt.Timestamp:yyyy-MM-dd HH:mm:ss}, " +
                $"VerifyMethod={evt.VerifyMethod}, Invalid={evt.IsInvalid}");

            // Buffer locally first - this is the step that makes attendance survive an
            // internet outage. We attempt an immediate push after, but the buffer write
            // happens regardless of whether that push succeeds.
            _outbox.Enqueue(evt.EnrollNumber, evt.Timestamp, evt.VerifyMethod, evt.IsInvalid);

            // Fire-and-forget immediate push attempt; the retry loop will catch it if this fails.
            _ = TryPushSingleEventAsync();
        }

        private async Task TryPushSingleEventAsync()
        {
            if (_api == null) return;

            var unsent = _outbox.GetUnsent(limit: 1);
            foreach (var row in unsent)
            {
                var dto = new AttendanceEventDto
                {
                    GymId = _config.GymId,
                    DeviceEnrollNumber = row.EnrollNumber,
                    EventTime = row.EventTime,
                    VerifyMethod = row.VerifyMethod,
                    IsInvalid = row.IsInvalid
                };

                bool sent = await _api.SendAttendanceAsync(dto);
                if (sent) _outbox.MarkSent(row.Id);
            }
        }

        // ---------- Background loops: heartbeat, command poll, retry flush ----------

        private void StartBackgroundLoops(CancellationToken token)
        {
            _ = HeartbeatLoopAsync(token);
            _ = CommandPollLoopAsync(token);
            _ = RetryFlushLoopAsync(token);
        }

        private async Task HeartbeatLoopAsync(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                bool ok = await _api.SendHeartbeatAsync(_device.IsConnected ? "online" : "device_disconnected");
                RunOnUi(() => UpdateApiStatus(ok));
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
                    var commands = await _api.GetPendingCommandsAsync();
                    foreach (var cmd in commands)
                    {
                        CommandExecutionResult result = ExecuteCommand(cmd);
                        await _api.AckCommandAsync(cmd.Id, result.Success ? "acked" : "failed", result.Message);
                        RunOnUi(() => Log($"Command {cmd.CommandType} for {cmd.EnrollNumber}: " +
                                           (result.Success ? "OK - " : "FAILED - ") + result.Message));
                    }
                }
                catch (Exception ex)
                {
                    RunOnUi(() => Log($"Command poll error: {ex.Message}"));
                }

                try { await Task.Delay(TimeSpan.FromSeconds(_config.CommandPollIntervalSeconds), token); }
                catch (TaskCanceledException) { break; }
            }
        }

        private CommandExecutionResult ExecuteCommand(PendingCommand cmd)
        {
            switch (cmd.CommandType)
            {
                case "enable_user":
                    return FromMembershipResult(_membershipAccess.RestoreMembershipAccess(cmd.EnrollNumber));
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
                    var unsent = _outbox.GetUnsent(limit: 50);
                    foreach (var row in unsent)
                    {
                        var dto = new AttendanceEventDto
                        {
                            GymId = _config.GymId,
                            DeviceEnrollNumber = row.EnrollNumber,
                            EventTime = row.EventTime,
                            VerifyMethod = row.VerifyMethod,
                            IsInvalid = row.IsInvalid
                        };
                        bool sent = await _api.SendAttendanceAsync(dto);
                        if (sent) _outbox.MarkSent(row.Id);
                    }
                }
                catch (Exception ex)
                {
                    RunOnUi(() => Log($"Retry flush error: {ex.Message}"));
                }

                try { await Task.Delay(TimeSpan.FromSeconds(_config.RetryFlushIntervalSeconds), token); }
                catch (TaskCanceledException) { break; }
            }
        }

        // ---------- Logging helpers ----------

        private void Log(string message)
        {
            if (InvokeRequired)
            {
                Invoke(new Action<string>(Log), message);
                return;
            }
            txtLog.AppendText($"[{DateTime.Now:HH:mm:ss}] {message}{Environment.NewLine}");
        }

        private void RunOnUi(Action action)
        {
            if (InvokeRequired) Invoke(action);
            else action();
        }

        private void BridgeForm_FormClosing(object sender, FormClosingEventArgs e)
        {
            _cts?.Cancel();
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
