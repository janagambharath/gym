using System;
using System.IO;
using Newtonsoft.Json;

namespace RenewalDeskBridge.Config
{
    /// <summary>
    /// All settings the bridge needs. Loaded from appsettings.json next to the .exe.
    /// This is intentionally a flat, simple file - the gym owner (via us) edits this
    /// once during setup and shouldn't need to touch it again.
    /// </summary>
    public class BridgeConfig
    {
        public string DeviceIp { get; set; } = "";
        public int DevicePort { get; set; } = 4370;
        public string DeviceCommPassword { get; set; } = "";

        // Machine number is mostly ignored by the SDK when using TCP/IP (any int is fine),
        // but we keep it configurable in case of serial fallback later.
        public int MachineNumber { get; set; } = 1;

        public string GymId { get; set; } = "";
        public string ApiBaseUrl { get; set; } = "http://localhost:5080"; // mock API default
        public string ApiKey { get; set; } = "";

        public int HeartbeatIntervalSeconds { get; set; } = 60;
        public int CommandPollIntervalSeconds { get; set; } = 10;
        public int RetryFlushIntervalSeconds { get; set; } = 30;

        private static readonly string ConfigPath =
            Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "appsettings.json");

        public static BridgeConfig Load()
        {
            if (!File.Exists(ConfigPath))
            {
                var fresh = new BridgeConfig();
                fresh.Save();
                return fresh;
            }

            string json = File.ReadAllText(ConfigPath);
            return JsonConvert.DeserializeObject<BridgeConfig>(json) ?? new BridgeConfig();
        }

        public void Save()
        {
            string json = JsonConvert.SerializeObject(this, Formatting.Indented);
            File.WriteAllText(ConfigPath, json);
        }
    }
}
