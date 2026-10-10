using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Xml;

namespace eBioServerBridge
{
    /// <summary>
    /// Client for the eBioServer SOAP web service (WebService.asmx).
    /// All methods require UserName + Password authentication.
    /// Supports both attendance retrieval AND device commands (block/unblock).
    /// </summary>
    public class EBioServerClient
    {
        private readonly string _baseUrl;
        private readonly string _soapEndpoint;
        private readonly string _apiUser;
        private readonly string _apiPassword;
        private string _lastError;

        public string LastError { get { return _lastError; } }

        public EBioServerClient(string baseUrl, string soapEndpoint, string apiUser, string apiPassword)
        {
            _baseUrl = baseUrl.TrimEnd('/');
            _soapEndpoint = soapEndpoint;
            _apiUser = apiUser;
            _apiPassword = apiPassword;
            _lastError = string.Empty;
        }

        // ────── Health ──────

        public bool IsConnected()
        {
            try
            {
                string soapBody = BuildSoapEnvelope("IseSSLebioServer", new Dictionary<string, string>());
                string response = SendSoapRequest("IseSSLebioServer", soapBody);
                return response != null && response.Contains(">1<");
            }
            catch
            {
                return false;
            }
        }

        // ────── Device List ──────

        public List<DeviceInfo> GetDeviceList()
        {
            var devices = new List<DeviceInfo>();
            try
            {
                var parms = new Dictionary<string, string>();
                parms["UserName"] = _apiUser;
                parms["Password"] = _apiPassword;
                parms["Location"] = "";

                string soapBody = BuildSoapEnvelope("GetDeviceList", parms);
                string response = SendSoapRequest("GetDeviceList", soapBody);
                if (string.IsNullOrEmpty(response) || IsErrorResponse(response))
                {
                    _lastError = string.Empty;
                    return devices;
                }

                ParseDataSetRows(response, "GetDeviceListResult", delegate(XmlNode row) {
                    var device = new DeviceInfo();
                    DateTime tempDt;
                    foreach (XmlNode col in row.ChildNodes)
                    {
                        switch (col.Name)
                        {
                            case "DeviceName": device.DeviceName = col.InnerText; break;
                            case "SerialNumber": device.SerialNumber = col.InnerText; break;
                            case "Status": device.Status = col.InnerText; break;
                            case "LastPing":
                                if (DateTime.TryParse(col.InnerText, out tempDt))
                                    device.LastPing = tempDt;
                                break;
                        }
                    }
                    devices.Add(device);
                });
            }
            catch (Exception ex) { _lastError = "GetDeviceList: " + ex.Message; }
            return devices;
        }

        // ────── Attendance Logs ──────

        public List<DeviceLogEntry> GetDeviceLogs(string logDate)
        {
            var logs = new List<DeviceLogEntry>();
            try
            {
                var parms = new Dictionary<string, string>();
                parms["UserName"] = _apiUser;
                parms["Password"] = _apiPassword;
                parms["Location"] = "";
                parms["LogDate"] = logDate;

                string soapBody = BuildSoapEnvelope("GetDeviceLogs", parms);
                string response = SendSoapRequest("GetDeviceLogs", soapBody);
                if (string.IsNullOrEmpty(response) || IsErrorResponse(response))
                {
                    _lastError = string.Empty;
                    return logs;
                }
                logs = ParseLogRows(response, "GetDeviceLogsResult");
            }
            catch (Exception ex) { _lastError = "GetDeviceLogs: " + ex.Message; }
            return logs;
        }

        public List<DeviceLogEntry> GetDeviceLogsByLogId(int logId)
        {
            var logs = new List<DeviceLogEntry>();
            try
            {
                var parms = new Dictionary<string, string>();
                parms["UserName"] = _apiUser;
                parms["Password"] = _apiPassword;
                parms["logId"] = logId.ToString();

                string soapBody = BuildSoapEnvelope("GetDeviceLogsByLogId", parms);
                string response = SendSoapRequest("GetDeviceLogsByLogId", soapBody);
                if (string.IsNullOrEmpty(response) || IsErrorResponse(response))
                {
                    _lastError = string.Empty;
                    return logs;
                }
                logs = ParseLogRows(response, "GetDeviceLogsByLogIdResult");
            }
            catch (Exception ex) { _lastError = "GetDeviceLogsByLogId: " + ex.Message; }
            return logs;
        }

        // ────── BLOCK / UNBLOCK USER (THE KEY METHOD) ──────

        /// <summary>
        /// Sends a block or unblock command to the device via eBioServer ADMS.
        /// This queues a command that eBioServer pushes to the device on next poll.
        /// </summary>
        /// <param name="deviceSerial">The device serial number</param>
        /// <param name="employeeCode">The employee/enroll number on the device</param>
        /// <param name="block">true=block (deny access), false=unblock (allow access)</param>
        /// <returns>CommandResult with success/failure and message</returns>
        public CommandResult BlockUnblockUser(string deviceSerial, string employeeCode, bool block)
        {
            try
            {
                var parms = new Dictionary<string, string>();
                parms["UserName"] = _apiUser;
                parms["Password"] = _apiPassword;
                parms["DeviceSerialNumber"] = deviceSerial;
                parms["EmployeeCode"] = employeeCode;
                parms["BlockUser"] = block ? "true" : "false";

                string soapBody = BuildSoapEnvelope("DeviceCommand_BlockUnBlockUser", parms);
                string response = SendSoapRequest("DeviceCommand_BlockUnBlockUser", soapBody);

                if (string.IsNullOrEmpty(response))
                    return new CommandResult(false, "Empty SOAP response");

                // Parse result
                string result = ExtractResultText(response, "DeviceCommand_BlockUnBlockUserResult");
                if (result == null)
                    return new CommandResult(false, "Could not parse SOAP response");

                // eBioServer returns "success" or "error" or a message
                bool success = result.ToLower().Contains("success") ||
                               result == "1" ||
                               result.ToLower() == "true";

                string action = block ? "BLOCK" : "UNBLOCK";
                if (success)
                {
                    _lastError = string.Empty;
                    return new CommandResult(true,
                        string.Format("{0} command accepted for employee {1} on device {2}. " +
                        "Note: eBioServer will push to device on next ADMS poll cycle.",
                        action, employeeCode, deviceSerial));
                }
                else
                {
                    _lastError = string.Format("{0} failed: {1}", action, result);
                    return new CommandResult(false, _lastError);
                }
            }
            catch (Exception ex)
            {
                _lastError = "BlockUnblockUser: " + ex.Message;
                return new CommandResult(false, _lastError);
            }
        }

        // ────── UNLOCK DOOR ──────

        public CommandResult UnlockDoor(string deviceSerial)
        {
            try
            {
                var parms = new Dictionary<string, string>();
                parms["UserName"] = _apiUser;
                parms["Password"] = _apiPassword;
                parms["DeviceSerialNumber"] = deviceSerial;

                string soapBody = BuildSoapEnvelope("DeviceCommand_UnlockDoor", parms);
                string response = SendSoapRequest("DeviceCommand_UnlockDoor", soapBody);

                string result = ExtractResultText(response, "DeviceCommand_UnlockDoorResult");
                bool success = result != null && (result.ToLower().Contains("success") || result == "1");

                return new CommandResult(success,
                    success ? "Unlock door command sent to device " + deviceSerial
                            : "Unlock failed: " + (result ?? "no response"));
            }
            catch (Exception ex)
            {
                _lastError = "UnlockDoor: " + ex.Message;
                return new CommandResult(false, _lastError);
            }
        }

        // ────── EMPLOYEE MANAGEMENT ──────

        public CommandResult UpdateEmployee(string employeeCode, string name, string location, string role)
        {
            try
            {
                var parms = new Dictionary<string, string>();
                parms["UserName"] = _apiUser;
                parms["Password"] = _apiPassword;
                parms["EmployeeCode"] = employeeCode;
                parms["EmployeeName"] = name ?? "";
                parms["EmployeeLocation"] = location ?? "";
                parms["EmployeeRole"] = role ?? "";
                parms["EmployeeVerificationType"] = "";

                string soapBody = BuildSoapEnvelope("UpdateEmployee", parms);
                string response = SendSoapRequest("UpdateEmployee", soapBody);

                string result = ExtractResultText(response, "UpdateEmployeeResult");
                bool success = result != null && !result.ToLower().Contains("error");

                return new CommandResult(success,
                    success ? "Employee " + employeeCode + " updated"
                            : "Update failed: " + (result ?? "no response"));
            }
            catch (Exception ex)
            {
                return new CommandResult(false, "UpdateEmployee: " + ex.Message);
            }
        }

        public string GetEmployeeDetails(string employeeCode)
        {
            try
            {
                var parms = new Dictionary<string, string>();
                parms["UserName"] = _apiUser;
                parms["Password"] = _apiPassword;
                parms["EmployeeCode"] = employeeCode;

                string soapBody = BuildSoapEnvelope("GetEmployeeDetails", parms);
                string response = SendSoapRequest("GetEmployeeDetails", soapBody);

                string result = ExtractResultText(response, "GetEmployeeDetailsResult");
                _lastError = string.Empty;
                return result;
            }
            catch (Exception ex)
            {
                _lastError = "GetEmployeeDetails: " + ex.Message;
                return null;
            }
        }

        /// <summary>
        /// Best-effort verification of an employee's block state via
        /// GetEmployeeDetails. Returns true when the device state matches the
        /// expectation, false when it contradicts it, null when the vendor
        /// response format is unrecognized or the query failed.
        /// </summary>
        public bool? VerifyBlockState(string employeeCode, bool expectBlocked)
        {
            string details = GetEmployeeDetails(employeeCode);
            if (string.IsNullOrEmpty(details))
                return null;
            string lower = details.ToLowerInvariant();
            bool? blocked = null;
            if (lower.Contains("<isblocked>true</isblocked>")
                || lower.Contains("\"isblocked\":true")
                || lower.Contains("blockuser>true")
                || lower.Contains(">blocked<"))
                blocked = true;
            else if (lower.Contains("<isblocked>false</isblocked>")
                || lower.Contains("\"isblocked\":false")
                || lower.Contains("blockuser>false")
                || lower.Contains(">unblocked<"))
                blocked = false;
            if (!blocked.HasValue)
                return null;
            return blocked.Value == expectBlocked;
        }

        public CommandResult DeleteEmployee(string employeeCode)
        {
            try
            {
                var parms = new Dictionary<string, string>();
                parms["UserName"] = _apiUser;
                parms["Password"] = _apiPassword;
                parms["EmployeeCode"] = employeeCode;

                string soapBody = BuildSoapEnvelope("DeleteEmployee", parms);
                string response = SendSoapRequest("DeleteEmployee", soapBody);

                string result = ExtractResultText(response, "DeleteEmployeeResult");
                bool success = result != null && !result.ToLower().Contains("error");

                return new CommandResult(success,
                    success ? "Employee " + employeeCode + " deleted"
                            : "Delete failed: " + (result ?? "no response"));
            }
            catch (Exception ex)
            {
                return new CommandResult(false, "DeleteEmployee: " + ex.Message);
            }
        }

        // ────── Internal Helpers ──────

        private bool IsErrorResponse(string response)
        {
            return response.Contains(">error<") || response.Contains(">Error<");
        }

        private string ExtractResultText(string response, string resultElementName)
        {
            if (string.IsNullOrEmpty(response)) return null;
            try
            {
                var doc = new XmlDocument { XmlResolver = null };
                doc.LoadXml(response);
                var nsMgr = new XmlNamespaceManager(doc.NameTable);
                nsMgr.AddNamespace("soap", "http://schemas.xmlsoap.org/soap/envelope/");
                nsMgr.AddNamespace("ns", "http://tempuri.org/");

                var node = doc.SelectSingleNode("//ns:" + resultElementName, nsMgr);
                return node != null ? node.InnerText : null;
            }
            catch { return null; }
        }

        private delegate void RowHandler(XmlNode row);

        private void ParseDataSetRows(string response, string resultElementName, RowHandler handler)
        {
            var doc = new XmlDocument { XmlResolver = null };
            doc.LoadXml(response);
            var nsMgr = new XmlNamespaceManager(doc.NameTable);
            nsMgr.AddNamespace("soap", "http://schemas.xmlsoap.org/soap/envelope/");
            nsMgr.AddNamespace("ns", "http://tempuri.org/");

            var resultNode = doc.SelectSingleNode("//ns:" + resultElementName, nsMgr);
            if (resultNode == null || string.IsNullOrEmpty(resultNode.InnerXml)) return;

            try
            {
                var innerDoc = new XmlDocument { XmlResolver = null };
                innerDoc.LoadXml(resultNode.InnerXml);
                XmlNodeList rows = innerDoc.GetElementsByTagName("Table");
                if (rows.Count == 0) rows = innerDoc.GetElementsByTagName("Table1");
                foreach (XmlNode row in rows) handler(row);
            }
            catch { }
        }

        private List<DeviceLogEntry> ParseLogRows(string response, string resultElementName)
        {
            var logs = new List<DeviceLogEntry>();
            ParseDataSetRows(response, resultElementName, delegate(XmlNode row) {
                var log = new DeviceLogEntry();
                int tempInt;
                DateTime tempDt;
                foreach (XmlNode col in row.ChildNodes)
                {
                    switch (col.Name)
                    {
                        case "LogId": case "ID":
                            if (int.TryParse(col.InnerText, out tempInt)) log.LogId = tempInt;
                            break;
                        case "EmployeeCode": case "EmpCode": case "UserId":
                            log.EmployeeCode = col.InnerText; break;
                        case "LogDate": case "PunchDate": case "DateTime":
                            if (DateTime.TryParse(col.InnerText, out tempDt)) log.LogDate = tempDt;
                            break;
                        case "Direction": case "InOutMode":
                            log.Direction = col.InnerText; break;
                        case "DeviceName": case "Device":
                            log.DeviceName = col.InnerText; break;
                        case "SerialNumber": case "DeviceSerial":
                            log.SerialNumber = col.InnerText; break;
                    }
                }
                logs.Add(log);
            });
            _lastError = string.Empty;
            return logs;
        }

        private string BuildSoapEnvelope(string methodName, Dictionary<string, string> parameters)
        {
            var sb = new StringBuilder();
            sb.AppendLine("<?xml version=\"1.0\" encoding=\"utf-8\"?>");
            sb.AppendLine("<soap:Envelope xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\" xmlns:tem=\"http://tempuri.org/\">");
            sb.AppendLine("  <soap:Body>");
            sb.AppendLine("    <tem:" + methodName + ">");
            foreach (var kvp in parameters)
            {
                string escaped = System.Security.SecurityElement.Escape(kvp.Value);
                sb.AppendLine("      <tem:" + kvp.Key + ">" + escaped + "</tem:" + kvp.Key + ">");
            }
            sb.AppendLine("    </tem:" + methodName + ">");
            sb.AppendLine("  </soap:Body>");
            sb.AppendLine("</soap:Envelope>");
            return sb.ToString();
        }

        private string SendSoapRequest(string soapAction, string soapBody)
        {
            string url = _baseUrl + _soapEndpoint;
            var request = (HttpWebRequest)WebRequest.Create(url);
            request.Method = "POST";
            request.ContentType = "text/xml; charset=utf-8";
            request.Headers.Add("SOAPAction", "\"http://tempuri.org/" + soapAction + "\"");
            request.Timeout = 30000;
            // Without this, a stalled mid-response hangs the single-threaded
            // bridge loop for the 5-minute HttpWebRequest default.
            request.ReadWriteTimeout = 30000;

            byte[] bodyBytes = Encoding.UTF8.GetBytes(soapBody);
            request.ContentLength = bodyBytes.Length;

            using (var stream = request.GetRequestStream())
            {
                stream.Write(bodyBytes, 0, bodyBytes.Length);
            }

            using (var response = (HttpWebResponse)request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
            {
                _lastError = string.Empty;
                return reader.ReadToEnd();
            }
        }
    }

    // ────── Models ──────

    public class CommandResult
    {
        public bool Success { get; set; }
        public string Message { get; set; }

        public CommandResult(bool success, string message)
        {
            Success = success;
            Message = message;
        }
    }

    public class DeviceLogEntry
    {
        public int LogId { get; set; }
        public string EmployeeCode { get; set; }
        public DateTime LogDate { get; set; }
        public string Direction { get; set; }
        public string DeviceName { get; set; }
        public string SerialNumber { get; set; }
    }

    public class DeviceInfo
    {
        public string DeviceName { get; set; }
        public string SerialNumber { get; set; }
        public string Status { get; set; }
        public DateTime LastPing { get; set; }
    }
}
