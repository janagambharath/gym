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
        private readonly HttpClient _http;
        private readonly string _gymId;

        public RenewalDeskClient(string baseUrl, string apiKey, string gymId)
        {
            _gymId = gymId;
            _http = new HttpClient { BaseAddress = new Uri(baseUrl) };
            _http.DefaultRequestHeaders.Add("X-Api-Key", apiKey);
            _http.Timeout = TimeSpan.FromSeconds(15);
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
                var resp = await _http.GetAsync($"/api/bridge/v1/commands/pending?gymId={_gymId}");
                if (!resp.IsSuccessStatusCode) return Array.Empty<PendingCommand>();

                string json = await resp.Content.ReadAsStringAsync();
                return JsonConvert.DeserializeObject<PendingCommand[]>(json) ?? Array.Empty<PendingCommand>();
            }
            catch
            {
                // Network hiccup - caller's poll loop will just try again next cycle.
                // Not logging here to avoid noisy logs on flaky connections; the poll
                // loop itself should log a summary if this keeps failing repeatedly.
                return Array.Empty<PendingCommand>();
            }
        }

        public async Task<bool> AckCommandAsync(string commandId, string status, string errorMessage = null)
        {
            var payload = new { status, errorMessage };
            return await PostAsync($"/api/bridge/v1/commands/{commandId}/ack", payload);
        }

        public async Task<bool> ConfirmEnrollmentAsync(string memberId, string deviceEnrollNumber)
        {
            var payload = new { memberId, deviceEnrollNumber, gymId = _gymId };
            return await PostAsync("/api/bridge/v1/enrollment/confirm", payload);
        }

        private async Task<bool> PostAsync(string path, object payload)
        {
            try
            {
                string json = JsonConvert.SerializeObject(payload);
                var content = new StringContent(json, Encoding.UTF8, "application/json");
                var resp = await _http.PostAsync(path, content);
                return resp.IsSuccessStatusCode;
            }
            catch
            {
                return false;
            }
        }
    }

    public class AttendanceEventDto
    {
        public string GymId { get; set; }
        public string DeviceEnrollNumber { get; set; }
        public DateTime EventTime { get; set; }
        public int VerifyMethod { get; set; }
        public bool IsInvalid { get; set; }
    }

    public class PendingCommand
    {
        public string Id { get; set; }
        public string CommandType { get; set; } // enable_user, disable_user, create_user, delete_user, unlock_door
        public string EnrollNumber { get; set; }
        public string MemberName { get; set; }
        public int? DelaySeconds { get; set; }
    }
}
