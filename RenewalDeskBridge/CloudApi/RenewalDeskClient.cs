using System;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;

namespace RenewalDeskBridge.CloudApi
{
    /// <summary>
    /// Talks to the Renewal Desk backend (or the local MockApi during dev/testing -
    /// same contract either way, so switching from mock to real later is just changing
    /// ApiBaseUrl in appsettings.json, no code changes needed).
    ///
    /// Endpoint contract (5 endpoints total):
    ///   POST /api/bridge/v1/heartbeat
    ///   POST /api/bridge/v1/attendance
    ///   GET  /api/bridge/v1/commands/pending?gymId=...
    ///   POST /api/bridge/v1/commands/{id}/ack
    ///   POST /api/bridge/v1/enrollment/confirm
    /// </summary>
    public class RenewalDeskClient
    {
        // Try a direct HTTPS connection first.  Some gym laptops have a stale
        // Windows proxy configuration which breaks System.Net.Http even though a
        // browser can open the same Railway URL.  If direct HTTPS is unavailable,
        // retry once through the normal system-proxy path.
        private readonly HttpClient _directHttp;
        private readonly HttpClient _proxyHttp;
        private readonly string _gymId;

        // Surface a safe diagnostic to the WinForms log.  Previously every HTTP
        // failure looked identical (just a red status), which made on-site setup
        // needlessly difficult.  This never contains the API key.
        public string LastError { get; private set; } = string.Empty;

        public RenewalDeskClient(string baseUrl, string apiKey, string gymId, string deviceSerial)
        {
            _gymId = gymId;
            var baseUri = new Uri(baseUrl.TrimEnd('/') + "/");
            _directHttp = CreateHttpClient(baseUri, apiKey, deviceSerial, useProxy: false);
            _proxyHttp = CreateHttpClient(baseUri, apiKey, deviceSerial, useProxy: true);
        }

        public async Task<bool> SendHeartbeatAsync(string status)
        {
            var payload = new { gymId = _gymId, status, timestamp = DateTime.UtcNow };
            return await PostAsync("/api/bridge/v1/heartbeat", payload);
        }

        public async Task<bool> SendAttendanceAsync(AttendanceEventDto evt)
        {
            return await PostAsync("/api/bridge/v1/attendance", evt);
        }

        public async Task<PendingCommand[]> GetPendingCommandsAsync()
        {
            try
            {
                using (var resp = await GetWithNetworkFallbackAsync(
                    $"/api/bridge/v1/commands/pending?gymId={Uri.EscapeDataString(_gymId)}"))
                {
                    if (!resp.IsSuccessStatusCode)
                    {
                        LastError = await DescribeHttpFailureAsync("GET /api/bridge/v1/commands/pending", resp);
                        return Array.Empty<PendingCommand>();
                    }

                    LastError = string.Empty;
                    string json = await resp.Content.ReadAsStringAsync();
                    return JsonConvert.DeserializeObject<PendingCommand[]>(json) ?? Array.Empty<PendingCommand>();
                }
            }
            catch (Exception ex)
            {
                LastError = DescribeException(ex);
                return Array.Empty<PendingCommand>();
            }
        }

        /// <summary>
        /// Acknowledge a leased command.  The lease token is deliberately part of the
        /// body rather than inferred from the command ID: a late bridge must never
        /// acknowledge a newer worker's lease by accident.
        /// </summary>
        public async Task<bool> AckCommandAsync(string commandId, string status, string errorMessage,
                                                string leaseToken)
        {
            var payload = new { status, errorMessage, leaseToken };
            return await PostAsync($"/api/bridge/v1/commands/{Uri.EscapeDataString(commandId)}/ack", payload);
        }

        public async Task<bool> ConfirmEnrollmentAsync(string memberId, string deviceEnrollNumber,
                                                       string terminalUserName)
        {
            var payload = new { memberId, deviceEnrollNumber, terminalUserName, gymId = _gymId };
            return await PostAsync("/api/bridge/v1/enrollment/confirm", payload);
        }

        private async Task<bool> PostAsync(string path, object payload)
        {
            try
            {
                using (var resp = await PostWithNetworkFallbackAsync(path, payload))
                {
                    if (resp.IsSuccessStatusCode)
                    {
                        LastError = string.Empty;
                        return true;
                    }

                    LastError = await DescribeHttpFailureAsync("POST " + path, resp);
                    return false;
                }
            }
            catch (Exception ex)
            {
                LastError = DescribeException(ex);
                return false;
            }
        }

        private static HttpClient CreateHttpClient(Uri baseUri, string apiKey, string deviceSerial, bool useProxy)
        {
            var handler = new HttpClientHandler { UseProxy = useProxy };
            var client = new HttpClient(handler) { BaseAddress = baseUri };
            client.DefaultRequestHeaders.Add("X-Api-Key", apiKey);
            client.DefaultRequestHeaders.Add("X-RenewalDesk-Bridge-Protocol", "2");
            client.DefaultRequestHeaders.Add("X-Device-Serial", deviceSerial);
            client.Timeout = TimeSpan.FromSeconds(15);
            return client;
        }

        private async Task<HttpResponseMessage> PostWithNetworkFallbackAsync(string path, object payload)
        {
            try
            {
                return await PostWithClientAsync(_directHttp, path, payload);
            }
            catch (HttpRequestException directException)
            {
                try
                {
                    return await PostWithClientAsync(_proxyHttp, path, payload);
                }
                catch (Exception proxyException)
                {
                    throw new HttpRequestException(
                        "Direct HTTPS and the Windows-proxy fallback both failed. Direct: " +
                        DescribeException(directException) + " | Proxy fallback: " +
                        DescribeException(proxyException), proxyException);
                }
            }
        }

        private static async Task<HttpResponseMessage> PostWithClientAsync(HttpClient client, string path, object payload)
        {
            string json = JsonConvert.SerializeObject(payload);
            using (var content = new StringContent(json, Encoding.UTF8, "application/json"))
            {
                return await client.PostAsync(path, content);
            }
        }

        private async Task<HttpResponseMessage> GetWithNetworkFallbackAsync(string path)
        {
            try
            {
                return await _directHttp.GetAsync(path);
            }
            catch (HttpRequestException directException)
            {
                try
                {
                    return await _proxyHttp.GetAsync(path);
                }
                catch (Exception proxyException)
                {
                    throw new HttpRequestException(
                        "Direct HTTPS and the Windows-proxy fallback both failed. Direct: " +
                        DescribeException(directException) + " | Proxy fallback: " +
                        DescribeException(proxyException), proxyException);
                }
            }
        }

        private static async Task<string> DescribeHttpFailureAsync(string request, HttpResponseMessage response)
        {
            string responseBody = await response.Content.ReadAsStringAsync();
            if (responseBody.Length > 500)
                responseBody = responseBody.Substring(0, 500) + "...";

            return request + " returned " + (int)response.StatusCode + " (" +
                   response.ReasonPhrase + "). " + responseBody;
        }

        private static string DescribeException(Exception exception)
        {
            if (exception == null) return "Unknown HTTP failure.";

            var details = new StringBuilder();
            for (Exception current = exception; current != null; current = current.InnerException)
            {
                if (details.Length > 0) details.Append(" --> ");
                details.Append(current.GetType().Name).Append(": ").Append(current.Message);
            }
            return details.ToString();
        }
    }

    public class AttendanceEventDto
    {
        // Generated once when the scan is written to outbox.db.  Retries reuse the
        // same value, allowing the online API to safely deduplicate them.
        [JsonProperty("eventId")]
        public string EventId { get; set; }
        [JsonProperty("gymId")]
        public string GymId { get; set; }
        [JsonProperty("deviceEnrollNumber")]
        public string DeviceEnrollNumber { get; set; }
        [JsonProperty("eventTime")]
        public DateTime EventTime { get; set; }
        [JsonProperty("verifyMethod")]
        public int VerifyMethod { get; set; }
        [JsonProperty("isInvalid")]
        public bool IsInvalid { get; set; }
    }

    public class PendingCommand
    {
        [JsonProperty("id")]
        public string Id { get; set; }
        // Issued by the online API when it leases this command to this bridge.
        // It must be returned unchanged in the acknowledgement body.
        [JsonProperty("leaseToken")]
        public string LeaseToken { get; set; }
        [JsonProperty("commandType")]
        public string CommandType { get; set; } // enable_user, disable_user, create_user, delete_user, unlock_door
        [JsonProperty("enrollNumber")]
        public string EnrollNumber { get; set; }
        [JsonProperty("memberName")]
        public string MemberName { get; set; }
        [JsonProperty("delaySeconds")]
        public int? DelaySeconds { get; set; }
    }
}
