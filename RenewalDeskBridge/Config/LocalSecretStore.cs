using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json;

namespace RenewalDeskBridge.Config
{
    /// <summary>
    /// DPAPI-protected secrets for the gym PC running the bridge.
    /// The API key is sufficient to queue door commands via the cloud, so it
    /// must never sit in plaintext appsettings.json (which Save() rewrites on
    /// every Connect click and every access-policy change).
    /// </summary>
    public static class LocalSecretStore
    {
        private static readonly string SecretFile = Path.Combine(
            AppDomain.CurrentDomain.BaseDirectory, "bridge_secrets.dat");

        public class BridgeSecrets
        {
            public string ApiKey { get; set; } = "";
            public string DeviceCommPassword { get; set; } = "";
        }

        public static BridgeSecrets Load()
        {
            if (!File.Exists(SecretFile)) return new BridgeSecrets();
            try
            {
                byte[] encrypted = File.ReadAllBytes(SecretFile);
                byte[] clear = ProtectedData.Unprotect(encrypted, null, DataProtectionScope.CurrentUser);
                return JsonConvert.DeserializeObject<BridgeSecrets>(Encoding.UTF8.GetString(clear))
                    ?? new BridgeSecrets();
            }
            catch { return new BridgeSecrets(); }
        }

        public static void Save(BridgeSecrets secrets)
        {
            string json = JsonConvert.SerializeObject(secrets);
            byte[] encrypted = ProtectedData.Protect(
                Encoding.UTF8.GetBytes(json), null, DataProtectionScope.CurrentUser);
            File.WriteAllBytes(SecretFile, encrypted);
        }
    }
}
