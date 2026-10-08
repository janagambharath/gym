using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json;

namespace eBioServerBridge
{
    /// <summary>DPAPI-protected secrets for the local gym PC only.</summary>
    public static class LocalSecretStore
    {
        private static readonly string SecretFile = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "bridge_secrets.dat");

        public static BridgeSecrets Load()
        {
            if (!File.Exists(SecretFile)) return null;
            try
            {
                byte[] encrypted = File.ReadAllBytes(SecretFile);
                byte[] clear = ProtectedData.Unprotect(encrypted, null, DataProtectionScope.CurrentUser);
                return JsonConvert.DeserializeObject<BridgeSecrets>(Encoding.UTF8.GetString(clear));
            }
            catch { return null; }
        }

        public static void Save(BridgeSecrets secrets)
        {
            string json = JsonConvert.SerializeObject(secrets);
            byte[] encrypted = ProtectedData.Protect(Encoding.UTF8.GetBytes(json), null, DataProtectionScope.CurrentUser);
            File.WriteAllBytes(SecretFile, encrypted);
        }
    }

    public class BridgeSecrets
    {
        public string EBioServerApiUser { get; set; }
        public string EBioServerApiPassword { get; set; }
        public string RenewalDeskApiKey { get; set; }
        public string RenewalDeskGymId { get; set; }
    }
}
