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
        private static int _totalSynced;
        private static int _totalErrors;
        private static int _totalCommands;
        private static bool _running = true;
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
                Console.ReadKey();
                return;
            }

            _config = JsonConvert.DeserializeObject<BridgeConfig>(File.ReadAllText(configPath));
            if (string.IsNullOrEmpty(_config.eBioServerUrl))
            {
                Log("ERROR: eBioServerUrl is required in appsettings.json", ConsoleColor.Red);
                Console.ReadKey();
                return;
            }

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
                var devices = _ebioClient.GetDeviceList();
                Log(string.Format("eBioServer connected! Devices found: {0}", devices.Count), ConsoleColor.Green);
                foreach (var dev in devices)
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
            string today = DateTime.Now.ToString("yyyy-MM-dd");
            var logs = _ebioClient.GetDeviceLogs(today);
            if (!string.IsNullOrEmpty(_ebioClient.LastError))
                return;

            // Filter out already-seen logs
            var newLogs = new List<DeviceLogEntry>();
            foreach (var log in logs)
            {
                if (log.LogId > _lastLogId)
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
                    evt.EventTime = log.LogDate;
                    evt.VerifyMethod = 1; // fingerprint
                    evt.AttState = attState;
                    evt.IsInvalid = false;

                    bool sent = _cloudClient.SendAttendance(evt);
                    if (sent)
                    {
                        _totalSynced++;
                    }
                    else
                    {
                        _totalErrors++;
                        Log("  Cloud upload failed: " + _cloudClient.LastError, ConsoleColor.Red);
                    }
                }

                if (log.LogId > _lastLogId)
                    _lastLogId = log.LogId;
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
                                Log("  -> " + result.Message, ConsoleColor.Green);
                                _totalCommands++;
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
                                Log("  -> " + result.Message, ConsoleColor.Green);
                                _totalCommands++;
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
            bool sent = _cloudClient.SendHeartbeat(status);
            if (!sent)
            {
                Log("Heartbeat failed: " + _cloudClient.LastError, ConsoleColor.Yellow);
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
                    if (state != null) _lastLogId = state.LastLogId;
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
                state.LastSyncTime = DateTime.UtcNow.ToString("o");
                File.WriteAllText(StateFile, JsonConvert.SerializeObject(state));
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
        public int PollIntervalSeconds { get; set; }
        public int HeartbeatIntervalSeconds { get; set; }
        public int CommandPollIntervalSeconds { get; set; }

        public BridgeConfig()
        {
            eBioServerSoapEndpoint = "/WebService.asmx";
            eBioServerApiUser = "essl";
            eBioServerApiPassword = "admin";
            PollIntervalSeconds = 15;
            HeartbeatIntervalSeconds = 60;
            CommandPollIntervalSeconds = 10;
        }
    }

    public class BridgeState
    {
        public int LastLogId { get; set; }
        public string LastSyncTime { get; set; }
    }
}
