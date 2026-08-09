using System;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
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
        private RenewalDeskClient _api;

        private CancellationTokenSource _cts;

        public BridgeForm()
        {
            InitializeComponent();
            _config = BridgeConfig.Load();
            LoadConfigIntoFields();

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
        }

        private void SaveFieldsIntoConfig()
        {
            _config.DeviceIp = txtDeviceIp.Text.Trim();
            _config.DevicePort = int.TryParse(txtDevicePort.Text.Trim(), out int p) ? p : 4370;
            _config.DeviceCommPassword = txtCommPassword.Text.Trim();
            _config.GymId = txtGymId.Text.Trim();
            _config.ApiBaseUrl = txtApiBaseUrl.Text.Trim();
            _config.ApiKey = txtApiKey.Text.Trim();
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

            // Never create a user as a side effect of a manual enable/disable test. A
            // typo must not overwrite or create a record on a live member device.
            bool ok = _device.SetUserEnabled(enrollNumber, enabled);
            if (!ok)
            {
                Log($"FAILED to set user {enrollNumber} to {(enabled ? "ENABLED" : "DISABLED")}. " +
                    $"Device error code: {_device.GetLastErrorCode()}. The user was not created or modified.");
                return;
            }

            bool readBack;
            if (_device.TryGetUserEnabled(enrollNumber, out readBack))
            {
                if (readBack == enabled)
                {
                    Log($"User {enrollNumber} set to {(enabled ? "ENABLED" : "DISABLED")} " +
                        "(device read-back confirmed). Now physically test their fingerprint at the device to confirm.");
                }
                else
                {
                    Log($"WARNING: device accepted the {(enabled ? "ENABLE" : "DISABLE")} command for user " +
                        $"{enrollNumber}, but read-back says {(readBack ? "ENABLED" : "DISABLED")}. " +
                        "Do not rely on this result; restore the intended state and investigate the device.");
                }
            }
            else
            {
                Log($"User {enrollNumber} command was accepted, but the bridge could not read the state back " +
                    $"(device error code: {_device.GetLastErrorCode()}). Do not rely on it until physical testing succeeds.");
            }
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
                        bool ok = ExecuteCommand(cmd);
                        await _api.AckCommandAsync(cmd.Id, ok ? "acked" : "failed");
                        RunOnUi(() => Log($"Command {cmd.CommandType} for {cmd.EnrollNumber}: " +
                                           (ok ? "OK" : "FAILED")));
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

        private bool ExecuteCommand(PendingCommand cmd)
        {
            switch (cmd.CommandType)
            {
                case "enable_user":
                    return _device.SetUserEnabled(cmd.EnrollNumber, true);
                case "disable_user":
                    return _device.SetUserEnabled(cmd.EnrollNumber, false);
                case "create_user":
                    return _device.SetUser(cmd.EnrollNumber, cmd.MemberName ?? "Member", true);
                case "delete_user":
                    return _device.DeleteUser(cmd.EnrollNumber);
                case "unlock_door":
                    return _device.UnlockDoor(cmd.DelaySeconds ?? 5);
                default:
                    return false;
            }
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
    }
}
