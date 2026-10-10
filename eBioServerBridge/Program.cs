using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using Newtonsoft.Json;

namespace eBioServerBridge
{
    /// <summary>
    /// eBioServer Bridge for Renewal Desk
    /// Connects eSSL biometric devices (via eBioServer/ADMS) to the Renewal Desk cloud.
    /// 
    /// Functions:
    /// 1. Polls eBioServer SOAP API for attendance logs and forwards to cloud
    /// 2. Polls Renewal Desk for pending commands (block/unblock) and executes via SOAP
    /// 3. Sends heartbeat to Renewal Desk
    /// </summary>
    class Program
    {
        private static BridgeConfig _config;
        private static EBioServerClient _ebioClient;
        private static RenewalDeskClient _cloudClient;
        private static int _lastLogId;
        private static Dictionary<string, int> _lastLogIdByDevice = new Dictionary<string, int>();

        private static int GetWatermark(string deviceSerial)
        {
            int watermark;
            if (!string.IsNullOrEmpty(deviceSerial) && _lastLogIdByDevice.TryGetValue(deviceSerial, out watermark))
                return watermark;
            return _lastLogId; // legacy single watermark (pre-upgrade state)
        }

        private static void SetWatermark(string deviceSerial, int logId)
        {
            if (string.IsNullOrEmpty(deviceSerial))
            {
                if (logId > _lastLogId) _lastLogId = logId;
                return;
            }
            int current;
            if (!_lastLogIdByDevice.TryGetValue(deviceSerial, out current) || logId > current)
                _lastLogIdByDevice[deviceSerial] = logId;
        }
        private static int _totalSynced;
        private static int _totalErrors;
        private static int _totalCommands;
        private static bool _running = true;
        private static List<DeviceInfo> _devices = new List<DeviceInfo>();
        private static readonly string StateFile = Path.Combine(
            AppDomain.CurrentDomain.BaseDirectory, "bridge_state.json");

        static void Main(string[] args)
        {
            Console.OutputEncoding = System.Text.Encoding.UTF8;
            PrintBanner();

            // Load config
            string configPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "appsettings.json");
            if (!File.Exists(configPath))
            {
                Log("ERROR: appsettings.json not found at " + configPath, ConsoleColor.Red);
                Log("Create appsettings.json with eBioServer and Renewal Desk settings.", ConsoleColor.Yellow);
                Environment.ExitCode = 1;
                return;
            }

            _config = JsonConvert.DeserializeObject<BridgeConfig>(File.ReadAllText(configPath));
            if (string.IsNullOrEmpty(_config.eBioServerUrl))
            {
                Log("ERROR: eBioServerUrl is required in appsettings.json", ConsoleColor.Red);
                Environment.ExitCode = 1;
                return;
            }

            // Credentials are only accepted from the setup JSON once.  They
            // are immediately moved to a DPAPI-protected local file bound to
            // the Windows account running this bridge.
            var secrets = LocalSecretStore.Load() ?? new BridgeSecrets();
            bool changedSecrets = false;
            if (string.IsNullOrEmpty(secrets.EBioServerApiUser) && !string.IsNullOrEmpty(_config.eBioServerApiUser))
            {
                secrets.EBioServerApiUser = _config.eBioServerApiUser;
                changedSecrets = true;
            }
            if (string.IsNullOrEmpty(secrets.EBioServerApiPassword) && !string.IsNullOrEmpty(_config.eBioServerApiPassword))
            {
                secrets.EBioServerApiPassword = _config.eBioServerApiPassword;
                changedSecrets = true;
            }
            if (string.IsNullOrEmpty(secrets.RenewalDeskApiKey) && !string.IsNullOrEmpty(_config.RenewalDeskApiKey))
            {
                secrets.RenewalDeskApiKey = _config.RenewalDeskApiKey;
                secrets.RenewalDeskGymId = _config.RenewalDeskGymId;
                changedSecrets = true;
            }

            // Discover a local device before pairing when setup did not supply
            // its serial. Owner selection can later switch through cloud config.
            if (string.IsNullOrWhiteSpace(_config.DeviceSerial) && !string.IsNullOrWhiteSpace(_config.eBioServerUrl))
            {
                var discovery = new EBioServerClient(_config.eBioServerUrl, _config.eBioServerSoapEndpoint,
                    secrets.EBioServerApiUser, secrets.EBioServerApiPassword);
                var discovered = discovery.GetDeviceList();
                var firstDevice = discovered.Find(d => !string.IsNullOrWhiteSpace(d.SerialNumber));
                if (firstDevice != null)
                {
                    _config.DeviceSerial = firstDevice.SerialNumber;
                    _config.DeviceName = firstDevice.DeviceName;
                    Log("Using discovered eBioServer device for initial pairing: " + firstDevice.DeviceName + " (" + firstDevice.SerialNumber + ")", ConsoleColor.Cyan);
                }
            }

            if (!string.IsNullOrEmpty(_config.PairingCode) && string.IsNullOrEmpty(secrets.RenewalDeskApiKey))
            {
                var paired = RenewalDeskClient.Pair(_config.RenewalDeskApiBaseUrl, _config.PairingCode,
                    _config.DeviceSerial, _config.DeviceName);
                if (paired == null || !paired.Ok || string.IsNullOrEmpty(paired.ApiKey))
                {
                    Log("ERROR: Pairing failed. Generate a new code in the RRR mobile app.", ConsoleColor.Red);
                    return;
                }
                secrets.RenewalDeskApiKey = paired.ApiKey;
                secrets.RenewalDeskGymId = paired.GymId;
                changedSecrets = true;
            }
            if (changedSecrets)
            {
                LocalSecretStore.Save(secrets);
                _config.eBioServerApiUser = "";
                _config.eBioServerApiPassword = "";
                _config.RenewalDeskApiKey = "";
                _config.RenewalDeskGymId = "";
                _config.PairingCode = "";
                File.WriteAllText(configPath, JsonConvert.SerializeObject(_config, Formatting.Indented));
            }
            _config.eBioServerApiUser = secrets.EBioServerApiUser;
            _config.eBioServerApiPassword = secrets.EBioServerApiPassword;
            _config.RenewalDeskApiKey = secrets.RenewalDeskApiKey;
            _config.RenewalDeskGymId = secrets.RenewalDeskGymId;

            // Initialize clients
            _ebioClient = new EBioServerClient(
                _config.eBioServerUrl,
                _config.eBioServerSoapEndpoint,
                _config.eBioServerApiUser,
                _config.eBioServerApiPassword);

            bool cloudEnabled = !string.IsNullOrEmpty(_config.RenewalDeskApiBaseUrl)
                             && !string.IsNullOrEmpty(_config.RenewalDeskApiKey);

            if (cloudEnabled)
            {
                _cloudClient = new RenewalDeskClient(
                    _config.RenewalDeskApiBaseUrl,
                    _config.RenewalDeskApiKey,
                    _config.RenewalDeskGymId,
                    _config.DeviceSerial);
                Log("Cloud sync ENABLED -> " + _config.RenewalDeskApiBaseUrl, ConsoleColor.Green);
            }
            else
            {
                Log("Cloud sync DISABLED (no RenewalDeskApiBaseUrl/ApiKey configured)", ConsoleColor.Yellow);
                Log("Running in LOCAL-ONLY mode: logs will be printed to console", ConsoleColor.Yellow);
            }

            // Load state
            LoadState();
            Log("Starting from LogId: " + _lastLogId, ConsoleColor.Gray);

            // Test eBioServer connection
            Log("Testing eBioServer connection...", ConsoleColor.White);
            if (_ebioClient.IsConnected())
            {
                _devices = _ebioClient.GetDeviceList();
                Log(string.Format("eBioServer connected! Devices found: {0}", _devices.Count), ConsoleColor.Green);
                foreach (var dev in _devices)
                {
                    Log(string.Format("  Device: {0} | Serial: {1} | Status: {2}",
                        dev.DeviceName, dev.SerialNumber, dev.Status), ConsoleColor.Cyan);
                }
            }
            else
            {
                Log("eBioServer connection issue: " + _ebioClient.LastError, ConsoleColor.Yellow);
                Log("Will retry on next poll cycle...", ConsoleColor.Yellow);
            }

            // Handle Ctrl+C
            Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs e) {
                e.Cancel = true;
                _running = false;
            };

            Log("Bridge running. Press Ctrl+C to stop.", ConsoleColor.White);
            Console.WriteLine();

            // Register discovered devices before the first attendance batch.
            if (_cloudClient != null)
                SendHeartbeat();

            // Main loop
            DateTime lastHeartbeat = DateTime.MinValue;
            DateTime lastCommandPoll = DateTime.MinValue;

            while (_running)
            {
                try
                {
                    // 1. Poll attendance logs
                    PollDeviceLogs();

                    // 2. Heartbeat
                    if (_cloudClient != null &&
                        (DateTime.Now - lastHeartbeat).TotalSeconds >= _config.HeartbeatIntervalSeconds)
                    {
                        SendHeartbeat();
                        lastHeartbeat = DateTime.Now;
                    }

                    // 3. Poll and execute commands
                    if (_cloudClient != null &&
                        (DateTime.Now - lastCommandPoll).TotalSeconds >= _config.CommandPollIntervalSeconds)
                    {
                        ProcessCloudCommands();
                        lastCommandPoll = DateTime.Now;
                    }
                }
                catch (Exception ex)
                {
                    _totalErrors++;
                    Log("Loop error: " + ex.Message, ConsoleColor.Red);
                }

                Thread.Sleep(_config.PollIntervalSeconds * 1000);
            }

            SaveState();
            Log(string.Format("Bridge stopped. Synced: {0} | Commands: {1} | Errors: {2}",
                _totalSynced, _totalCommands, _totalErrors), ConsoleColor.Cyan);
        }

        // ────── Attendance Polling ──────

        private static void PollDeviceLogs()
        {
            var logs = new List<DeviceLogEntry>();
            // Bounded look-back recovers punches across midnight or brief
            // outages; cloud event IDs make replay idempotent.
            for (int daysBack = 2; daysBack >= 0; daysBack--)
            {
                string date = DateTime.Now.Date.AddDays(-daysBack).ToString("yyyy-MM-dd");
                var dayLogs = _ebioClient.GetDeviceLogs(date);
                if (!string.IsNullOrEmpty(_ebioClient.LastError)) return;
                logs.AddRange(dayLogs);
            }
            logs.Sort((left, right) => left.LogDate.CompareTo(right.LogDate));

            // Filter out already-seen logs, per device. If a device's LogId
            // counter resets (DB rebuild/purge), the watermark would swallow
            // every future punch — detect the reset and re-baseline instead.
            var newLogs = new List<DeviceLogEntry>();
            var maxSeenByDevice = new Dictionary<string, int>();
            foreach (var log in logs)
            {
                string key = log.SerialNumber ?? "";
                int maxSeen;
                if (!maxSeenByDevice.TryGetValue(key, out maxSeen) || log.LogId > maxSeen)
                    maxSeenByDevice[key] = log.LogId;
            }
            foreach (var log in logs)
            {
                string key = log.SerialNumber ?? "";
                int watermark = GetWatermark(key);
                int maxSeen = maxSeenByDevice[key];
                if (maxSeen < watermark / 2 && watermark > 1000)
                {
                    // Counter reset: fall back to the date cursor (the 3-day
                    // lookback above) instead of the ID cursor.
                    Log(string.Format("LogId counter reset detected for device {0}; re-baselining.", key), ConsoleColor.Yellow);
                    SetWatermark(key, 0);
                    watermark = 0;
                }
                if (log.LogId > watermark)
                    newLogs.Add(log);
            }

            if (newLogs.Count == 0) return;

            Log(string.Format("Found {0} new punch log(s)", newLogs.Count), ConsoleColor.White);

            foreach (var log in newLogs)
            {
                // Determine check-in vs check-out
                int attState = 0;
                if (!string.IsNullOrEmpty(log.Direction))
                {
                    string dir = log.Direction.ToLower();
                    if (dir == "1" || dir == "out" || dir == "checkout") attState = 1;
                }

                Console.ForegroundColor = attState == 0 ? ConsoleColor.Green : ConsoleColor.Magenta;
                Console.Write(attState == 0 ? "  CHECK-IN  " : "  CHECK-OUT ");
                Console.ResetColor();
                Console.WriteLine(string.Format(
                    "Employee: {0} | Time: {1:yyyy-MM-dd HH:mm:ss} | Device: {2}",
                    log.EmployeeCode, log.LogDate, log.DeviceName));

                // Forward to Renewal Desk cloud
                if (_cloudClient != null)
                {
                    var evt = new AttendanceEvent();
                    evt.EventId = string.Format("ebio-{0}-{1}", log.LogId, log.LogDate.Ticks);
                    evt.GymId = _config.RenewalDeskGymId;
                    evt.DeviceEnrollNumber = log.EmployeeCode;
                    evt.DeviceSerial = log.SerialNumber;
                    evt.EventTime = log.LogDate;
                    evt.VerifyMethod = 1; // fingerprint
                    evt.AttState = attState;
                    evt.IsInvalid = false;

                    bool sent = _cloudClient.SendAttendance(evt);
                    if (sent)
                    {
                        _totalSynced++;
                        SetWatermark(log.SerialNumber, log.LogId);
                    }
                    else
                    {
                        _totalErrors++;
                        Log("  Cloud upload failed: " + _cloudClient.LastError, ConsoleColor.Red);
                        // Keep this and later records eligible for replay.
                        break;
                    }
                }
                else
                {
                    // Local-only mode has no remote acknowledgment to wait for.
                    SetWatermark(log.SerialNumber, log.LogId);
                }
            }

            SaveState();
        }

        // ────── Command Execution (BLOCK / UNBLOCK via SOAP) ──────

        private static void ProcessCloudCommands()
        {
            var commands = _cloudClient.GetPendingCommands();
            if (commands.Length == 0) return;

            foreach (var cmd in commands)
            {
                Log(string.Format("Command: {0} for enroll #{1} ({2})",
                    cmd.CommandType, cmd.EnrollNumber, cmd.MemberName), ConsoleColor.Cyan);

                string ackStatus = "acked";
                string errorMsg = null;

                try
                {
                    switch (cmd.CommandType)
                    {
                        case "disable_user":
                        {
                            // BLOCK user on device via eBioServer SOAP
                            Log("  -> BLOCKING user " + cmd.EnrollNumber + " on device " + _config.DeviceSerial, ConsoleColor.Yellow);
                            CommandResult result = _ebioClient.BlockUnblockUser(
                                _config.DeviceSerial, cmd.EnrollNumber, true);

                            if (result.Success)
                            {
                                // SOAP success only means eBioServer queued the push for
                                // the terminal's next poll. Verify before reporting done:
                                // an offline terminal must not read as "blocked".
                                bool? confirmed = _ebioClient.VerifyBlockState(cmd.EnrollNumber, true);
                                if (confirmed == false)
                                {
                                    Log("  -> Server accepted the block but the device has not applied it yet; will retry.", ConsoleColor.Yellow);
                                    ackStatus = "accepted";
                                    errorMsg = "eBioServer accepted the block; device delivery unconfirmed.";
                                }
                                else
                                {
                                    Log("  -> " + result.Message, ConsoleColor.Green);
                                    _totalCommands++;
                                }
                            }
                            else
                            {
                                Log("  -> FAILED: " + result.Message, ConsoleColor.Red);
                                ackStatus = "failed";
                                errorMsg = result.Message;
                                _totalErrors++;
                            }
                            break;
                        }

                        case "enable_user":
                        case "create_user":
                        {
                            // UNBLOCK user on device via eBioServer SOAP
                            Log("  -> UNBLOCKING user " + cmd.EnrollNumber + " on device " + _config.DeviceSerial, ConsoleColor.Green);
                            CommandResult result = _ebioClient.BlockUnblockUser(
                                _config.DeviceSerial, cmd.EnrollNumber, false);

                            if (result.Success)
                            {
                                bool? confirmed = _ebioClient.VerifyBlockState(cmd.EnrollNumber, false);
                                if (confirmed == false)
                                {
                                    Log("  -> Server accepted the unblock but the device has not applied it yet; will retry.", ConsoleColor.Yellow);
                                    ackStatus = "accepted";
                                    errorMsg = "eBioServer accepted the unblock; device delivery unconfirmed.";
                                }
                                else
                                {
                                    Log("  -> " + result.Message, ConsoleColor.Green);
                                    _totalCommands++;
                                }
                            }
                            else
                            {
                                Log("  -> FAILED: " + result.Message, ConsoleColor.Red);
                                ackStatus = "failed";
                                errorMsg = result.Message;
                                _totalErrors++;
                            }
                            break;
                        }

                        case "delete_user":
                        {
                            Log("  -> DELETING user " + cmd.EnrollNumber, ConsoleColor.Yellow);
                            CommandResult result = _ebioClient.DeleteEmployee(cmd.EnrollNumber);

                            if (result.Success)
                            {
                                Log("  -> " + result.Message, ConsoleColor.Green);
                                _totalCommands++;
                            }
                            else
                            {
                                ackStatus = "failed";
                                errorMsg = result.Message;
                                _totalErrors++;
                            }
                            break;
                        }

                        default:
                            Log("  -> Unknown command type: " + cmd.CommandType, ConsoleColor.Yellow);
                            ackStatus = "failed";
                            errorMsg = "Unsupported command type: " + cmd.CommandType;
                            break;
                    }
                }
                catch (Exception ex)
                {
                    ackStatus = "failed";
                    errorMsg = "Exception: " + ex.Message;
                    _totalErrors++;
                    Log("  -> EXCEPTION: " + ex.Message, ConsoleColor.Red);
                }

                // ACK back to Renewal Desk
                bool acked = _cloudClient.AckCommand(cmd.Id, ackStatus, errorMsg, cmd.LeaseToken);
                if (acked)
                {
                    Console.ForegroundColor = ackStatus == "acked" ? ConsoleColor.Green : ConsoleColor.Red;
                    Console.WriteLine("  -> ACK sent: " + ackStatus);
                    Console.ResetColor();
                }
                else
                {
                    Log("  -> ACK failed! Cloud may redeliver. Error: " + _cloudClient.LastError, ConsoleColor.Red);
                }
            }
        }

        // ────── Heartbeat ──────

        private static void SendHeartbeat()
        {
            bool connected = _ebioClient.IsConnected();
            string status = connected ? "online" : "device_disconnected";
            if (connected)
                _devices = _ebioClient.GetDeviceList();
            bool sent = _cloudClient.SendHeartbeat(status, _devices.ToArray());
            if (!sent)
            {
                Log("Heartbeat failed: " + _cloudClient.LastError, ConsoleColor.Yellow);
                return;
            }
            var selected = _cloudClient.GetConnectorConfig();
            if (selected != null && !string.IsNullOrWhiteSpace(selected.SelectedDeviceSerial))
            {
                var known = _devices.Find(d => string.Equals(d.SerialNumber, selected.SelectedDeviceSerial, StringComparison.OrdinalIgnoreCase));
                if (known != null)
                {
                    _config.DeviceSerial = known.SerialNumber;
                    _config.DeviceName = known.DeviceName;
                }
            }
        }

        // ────── State Persistence ──────

        private static void LoadState()
        {
            try
            {
                if (File.Exists(StateFile))
                {
                    var state = JsonConvert.DeserializeObject<BridgeState>(File.ReadAllText(StateFile));
                    if (state != null)
                    {
                        _lastLogId = state.LastLogId;
                        if (state.LastLogIdByDevice != null)
                            _lastLogIdByDevice = state.LastLogIdByDevice;
                    }
                }
            }
            catch { }
        }

        private static void SaveState()
        {
            try
            {
                var state = new BridgeState();
                state.LastLogId = _lastLogId;
                state.LastLogIdByDevice = _lastLogIdByDevice;
                state.LastSyncTime = DateTime.UtcNow.ToString("o");
                // Atomic write: a crash mid-write must not leave a torn file
                // that LoadState then silently treats as "no state".
                string tempFile = StateFile + ".tmp";
                File.WriteAllText(tempFile, JsonConvert.SerializeObject(state));
                File.Copy(tempFile, StateFile, true);
                File.Delete(tempFile);
            }
            catch { }
        }

        // ────── UI Helpers ──────

        private static void PrintBanner()
        {
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine();
            Console.WriteLine("  +--------------------------------------------------+");
            Console.WriteLine("  |   eBioServer Bridge for Renewal Desk              |");
            Console.WriteLine("  |   eSSL Device -> eBioServer -> Renewal Desk Cloud |");
            Console.WriteLine("  |   Attendance + Block/Unblock Commands             |");
            Console.WriteLine("  +--------------------------------------------------+");
            Console.ResetColor();
            Console.WriteLine();
        }

        private static void Log(string message, ConsoleColor color)
        {
            Console.ForegroundColor = color;
            Console.WriteLine("[{0:HH.mm.ss}] {1}", DateTime.Now, message);
            Console.ResetColor();
        }
    }

    // ────── Config & State Models ──────

    public class BridgeConfig
    {
        public string eBioServerUrl { get; set; }
        public string eBioServerSoapEndpoint { get; set; }
        public string eBioServerApiUser { get; set; }
        public string eBioServerApiPassword { get; set; }
        public string RenewalDeskApiBaseUrl { get; set; }
        public string RenewalDeskApiKey { get; set; }
        public string RenewalDeskGymId { get; set; }
        public string DeviceSerial { get; set; }
        public string DeviceName { get; set; }
        public string PairingCode { get; set; }
        public int PollIntervalSeconds { get; set; }
        public int HeartbeatIntervalSeconds { get; set; }
        public int CommandPollIntervalSeconds { get; set; }

        public BridgeConfig()
        {
            eBioServerSoapEndpoint = "/WebService.asmx";
            PollIntervalSeconds = 15;
            HeartbeatIntervalSeconds = 60;
            CommandPollIntervalSeconds = 10;
        }
    }

    public class BridgeState
    {
        public int LastLogId { get; set; }
        public Dictionary<string, int> LastLogIdByDevice { get; set; }
        public string LastSyncTime { get; set; }
    }
}
