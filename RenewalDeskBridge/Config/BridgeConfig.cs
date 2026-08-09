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

        // This legacy property name is retained for existing appsettings.json
        // files and the HTTP contract.  It is the backend-issued public bridge
        // ID, not the gym's database ID or a secret.
        public string GymId { get; set; } = "";
        public string ApiBaseUrl { get; set; } = "";
        public string ApiKey { get; set; } = "";

        public int HeartbeatIntervalSeconds { get; set; } = 60;
        public int CommandPollIntervalSeconds { get; set; } = 10;
        public int RetryFlushIntervalSeconds { get; set; } = 30;

        // Membership expiry on the X990 is enforced through a dedicated, per-user
        // access-control time zone.  These values are deliberately off by default:
        // a person at the physical door must prove the rule before the bridge accepts
        // automatic expiry commands.
        public int MembershipDenyTimeZoneId { get; set; } = 50;
        public string MembershipPolicyDeviceSerial { get; set; } = "";
        public bool MembershipAccessPolicyPrepared { get; set; } = false;
        public bool MembershipAccessPolicyPhysicallyVerified { get; set; } = false;

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
