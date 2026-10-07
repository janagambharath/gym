using System;
using System.IO;
using System.Net;
using System.Text;
using Newtonsoft.Json;

namespace eBioServerBridge
{
    public class RenewalDeskClient
    {
        private readonly string _baseUrl;
        private readonly string _apiKey;
        private readonly string _gymId;
        private readonly string _deviceSerial;
        private string _lastError;

        public string LastError { get { return _lastError; } }

        public RenewalDeskClient(string baseUrl, string apiKey, string gymId, string deviceSerial)
        {
            _baseUrl = baseUrl.TrimEnd('/');
            _apiKey = apiKey;
            _gymId = gymId;
            _deviceSerial = deviceSerial;
            _lastError = string.Empty;
        }

        public bool SendHeartbeat(string status)
        {
            var payload = new
            {
                gymId = _gymId,
                status = status,
                timestamp = DateTime.UtcNow.ToString("o"),
                version = "1.0.0-ebioserver",
                bridgeVersion = "1.0.0-ebioserver",
                pcName = Environment.MachineName,
                osInfo = Environment.OSVersion.ToString()
            };
            return Post("/api/bridge/v1/heartbeat", payload);
        }

        public bool SendAttendance(AttendanceEvent evt)
        {
            return Post("/api/bridge/v1/attendance", evt);
        }

        public PendingCommand[] GetPendingCommands()
        {
            try
            {
                string url = _baseUrl + "/api/bridge/v1/commands/pending?gymId=" + Uri.EscapeDataString(_gymId);
                var request = CreateRequest(url, "GET");
                using (var response = (HttpWebResponse)request.GetResponse())
                {
                    if (response.StatusCode != HttpStatusCode.OK)
                    {
                        _lastError = "GET commands/pending returned " + (int)response.StatusCode;
                        return new PendingCommand[0];
                    }
                    using (var reader = new StreamReader(response.GetResponseStream()))
                    {
                        string json = reader.ReadToEnd();
                        _lastError = string.Empty;
                        return JsonConvert.DeserializeObject<PendingCommand[]>(json) ?? new PendingCommand[0];
                    }
                }
            }
            catch (Exception ex)
            {
                _lastError = "GetPendingCommands: " + ex.Message;
                return new PendingCommand[0];
            }
        }

        public bool AckCommand(string commandId, string status, string errorMessage, string leaseToken)
        {
            var payload = new { status = status, errorMessage = errorMessage, leaseToken = leaseToken };
            return Post("/api/bridge/v1/commands/" + Uri.EscapeDataString(commandId) + "/ack", payload);
        }

        private bool Post(string path, object payload)
        {
            try
            {
                string url = _baseUrl + path;
                var request = CreateRequest(url, "POST");
                string json = JsonConvert.SerializeObject(payload);
                byte[] bodyBytes = Encoding.UTF8.GetBytes(json);
                request.ContentLength = bodyBytes.Length;

                using (var stream = request.GetRequestStream())
                {
                    stream.Write(bodyBytes, 0, bodyBytes.Length);
                }

                using (var response = (HttpWebResponse)request.GetResponse())
                {
                    _lastError = string.Empty;
                    int code = (int)response.StatusCode;
                    return code >= 200 && code < 300;
                }
            }
            catch (WebException wex)
            {
                HttpWebResponse errResp = wex.Response as HttpWebResponse;
                if (errResp != null)
                {
                    using (var reader = new StreamReader(errResp.GetResponseStream()))
                    {
                        string body = reader.ReadToEnd();
                        if (body.Length > 300) body = body.Substring(0, 300) + "...";
                        _lastError = "POST " + path + " -> " + (int)errResp.StatusCode + ": " + body;
                    }
                }
                else
                {
                    _lastError = "POST " + path + " -> " + wex.Message;
                }
                return false;
            }
            catch (Exception ex)
            {
                _lastError = "POST " + path + " -> " + ex.Message;
                return false;
            }
        }

        private HttpWebRequest CreateRequest(string url, string method)
        {
            var request = (HttpWebRequest)WebRequest.Create(url);
            request.Method = method;
            request.ContentType = "application/json; charset=utf-8";
            request.Headers.Add("X-Api-Key", _apiKey);
            request.Headers.Add("X-RenewalDesk-Bridge-Protocol", "2");
            request.Headers.Add("X-Device-Serial", _deviceSerial);
            request.Timeout = 15000;
            return request;
        }
    }

    public class AttendanceEvent
    {
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
        [JsonProperty("attState")]
        public int AttState { get; set; }
        [JsonProperty("isInvalid")]
        public bool IsInvalid { get; set; }
    }

    public class PendingCommand
    {
        [JsonProperty("id")]
        public string Id { get; set; }
        [JsonProperty("leaseToken")]
        public string LeaseToken { get; set; }
        [JsonProperty("commandType")]
        public string CommandType { get; set; }
        [JsonProperty("enrollNumber")]
        public string EnrollNumber { get; set; }
        [JsonProperty("memberName")]
        public string MemberName { get; set; }
        [JsonProperty("delaySeconds")]
        public int DelaySeconds { get; set; }
    }
}
