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
        [Newtonsoft.Json.JsonIgnore]
        public string DeviceCommPassword { get; set; } = "";

        // Machine number is mostly ignored by the SDK when using TCP/IP (any int is fine),
        // but we keep it configurable in case of serial fallback later.
        public int MachineNumber { get; set; } = 1;

        // This legacy property name is retained for existing appsettings.json
        // files and the HTTP contract.  It is the backend-issued public bridge
        // ID, not the gym's database ID or a secret.
        public string GymId { get; set; } = "";
        public string ApiBaseUrl { get; set; } = "";
        [Newtonsoft.Json.JsonIgnore]
        public string ApiKey { get; set; } = "";

        public int HeartbeatIntervalSeconds { get; set; } = 60;
        public int CommandPollIntervalSeconds { get; set; } = 10;
        public int RetryFlushIntervalSeconds { get; set; } = 30;

        // The particular X990 firmware currently being commissioned can terminate
        // a WinForms host when it receives a real-time COM attendance callback.
        // Keep the bridge stable for access-control commissioning by default. This
        // affects scan upload only; it never changes the fingerprint device's
        // access decision. Re-enable only after the terminal SDK event path has
        // been proven stable on this hardware.
        public bool EnableLiveAttendanceEvents { get; set; } = false;

        // Keep the client in connection-only commissioning mode until the X990
        // SDK's unstable optional access-control APIs have been replaced with a
        // model-verified integration. Heartbeats remain enabled, but the bridge
        // does not fetch or execute cloud commands in this mode.
        public bool EnableCloudCommandPolling { get; set; } = false;

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
            var config = JsonConvert.DeserializeObject<BridgeConfig>(json) ?? new BridgeConfig();
            MigratePlaintextSecrets(json, config);
            var secrets = LocalSecretStore.Load();
            if (!string.IsNullOrEmpty(secrets.ApiKey)) config.ApiKey = secrets.ApiKey;
            if (!string.IsNullOrEmpty(secrets.DeviceCommPassword)) config.DeviceCommPassword = secrets.DeviceCommPassword;
            return config;
        }

        private static void MigratePlaintextSecrets(string json, BridgeConfig config)
        {
            // One-time: move secrets out of the plaintext file into DPAPI.
            try
            {
                var raw = JsonConvert.DeserializeObject<System.Collections.Generic.Dictionary<string, object>>(json);
                string legacyKey = raw != null && raw.TryGetValue("ApiKey", out var k) ? k?.ToString() : null;
                string legacyComm = raw != null && raw.TryGetValue("DeviceCommPassword", out var c) ? c?.ToString() : null;
                if (string.IsNullOrEmpty(legacyKey) && string.IsNullOrEmpty(legacyComm)) return;
                var secrets = LocalSecretStore.Load();
                if (!string.IsNullOrEmpty(legacyKey) && string.IsNullOrEmpty(secrets.ApiKey))
                    secrets.ApiKey = legacyKey;
                if (!string.IsNullOrEmpty(legacyComm) && string.IsNullOrEmpty(secrets.DeviceCommPassword))
                    secrets.DeviceCommPassword = legacyComm;
                LocalSecretStore.Save(secrets);
                // Rewrite the file without the secrets.
                config.Save();
            }
            catch { /* migration is best-effort */ }
        }

        public void Save()
        {
            // ApiKey/DeviceCommPassword are [JsonIgnore]: they never land in
            // the plaintext file. Use SaveSecrets() for those.
            string json = JsonConvert.SerializeObject(this, Formatting.Indented);
            File.WriteAllText(ConfigPath, json);
        }

        public void SaveSecrets()
        {
            LocalSecretStore.Save(new LocalSecretStore.BridgeSecrets
            {
                ApiKey = ApiKey ?? "",
                DeviceCommPassword = DeviceCommPassword ?? "",
            });
        }
    }
}
