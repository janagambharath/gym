// ============================================================================
// MOCK Renewal Desk API - for testing the bridge before the real backend exists.
//
// This is a throwaway stand-in. It implements the exact 5 endpoints the bridge
// calls, with an in-memory command queue and attendance log, plus a tiny
// built-in test page so you (not the gym owner) can manually queue commands
// like "disable this user" and watch the bridge pick them up and apply them
// to the real device within a few seconds.
//
// Run with: dotnet run
// Then open: http://localhost:5080/  (test control panel)
// Point the bridge's "API URL" field at: http://localhost:5080
// ============================================================================

using System.Collections.Concurrent;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://localhost:5080");
var app = builder.Build();

// ---- in-memory state (resets every time you restart this mock) ----
var pendingCommands = new ConcurrentQueue<CommandRecord>();
var commandLog = new ConcurrentBag<CommandRecord>();
var attendanceLog = new ConcurrentBag<AttendanceRecord>();
var lastHeartbeat = new ConcurrentDictionary<string, HeartbeatRecord>();
int nextCommandId = 1;

// ---- POST /api/bridge/v1/heartbeat ----
app.MapPost("/api/bridge/v1/heartbeat", (HeartbeatRequest req) =>
{
    lastHeartbeat[req.gymId ?? "unknown"] = new HeartbeatRecord(req.status ?? "unknown", DateTime.UtcNow);
    Console.WriteLine($"[heartbeat] gym={req.gymId} status={req.status}");
    return Results.Ok();
});

// ---- POST /api/bridge/v1/attendance ----
app.MapPost("/api/bridge/v1/attendance", (AttendanceRequest req) =>
{
    attendanceLog.Add(new AttendanceRecord(req.gymId, req.deviceEnrollNumber, req.eventTime,
        req.verifyMethod, req.isInvalid, DateTime.UtcNow));
    Console.WriteLine($"[attendance] gym={req.gymId} enroll={req.deviceEnrollNumber} time={req.eventTime}");
    return Results.Ok();
});

// ---- GET /api/bridge/v1/commands/pending?gymId=... ----
app.MapGet("/api/bridge/v1/commands/pending", (string gymId) =>
{
    var toSend = new List<CommandRecord>();
    while (pendingCommands.TryPeek(out var cmd) && cmd.GymId == gymId)
    {
        if (pendingCommands.TryDequeue(out var dequeued))
        {
            toSend.Add(dequeued);
        }
    }
    // Note: this simple dequeue-all-matching approach is fine for a single-gym mock;
    // a real backend would filter by gymId in a SQL WHERE clause instead.
    if (toSend.Count > 0)
        Console.WriteLine($"[commands] sending {toSend.Count} pending command(s) to gym={gymId}");

    return Results.Json(toSend.Select(c => new
    {
        id = c.Id.ToString(),
        commandType = c.CommandType,
        enrollNumber = c.EnrollNumber,
        memberName = c.MemberName,
        delaySeconds = c.DelaySeconds
    }));
});

// ---- POST /api/bridge/v1/commands/{id}/ack ----
app.MapPost("/api/bridge/v1/commands/{id}/ack", (string id, AckRequest req) =>
{
    Console.WriteLine($"[ack] command={id} status={req.status} error={req.errorMessage}");
    return Results.Ok();
});

// ---- POST /api/bridge/v1/enrollment/confirm ----
app.MapPost("/api/bridge/v1/enrollment/confirm", (EnrollmentConfirmRequest req) =>
{
    Console.WriteLine($"[enrollment] member={req.memberId} -> device enroll #{req.deviceEnrollNumber}");
    return Results.Ok();
});

// ---- Tiny manual test control panel (NOT for the gym owner - this is your dev tool) ----
app.MapGet("/", () => Results.Content($"""
<html><body style="font-family: sans-serif; max-width: 700px; margin: 40px auto;">
<h2>Renewal Desk Mock API - Test Panel</h2>
<p>This lets you queue a command manually and watch the bridge (running on the gym PC)
pick it up within its poll interval and apply it to the real device.</p>

<h3>Queue a command</h3>
<form method="post" action="/test/queue">
  Gym ID: <input name="gymId" value="test-gym-1"><br><br>
  Command:
  <select name="commandType">
    <option value="enable_user">enable_user</option>
    <option value="disable_user">disable_user</option>
    <option value="create_user">create_user</option>
    <option value="delete_user">delete_user</option>
    <option value="unlock_door">unlock_door</option>
  </select><br><br>
  Enroll Number: <input name="enrollNumber" value="1001"><br><br>
  Member Name (only for create_user): <input name="memberName" value="Test Member"><br><br>
  <button type="submit">Queue Command</button>
</form>

<h3>Recent attendance ({attendanceLog.Count} total)</h3>
<pre>{string.Join("\n", attendanceLog.OrderByDescending(a => a.ReceivedAt).Take(10)
    .Select(a => $"{a.ReceivedAt:HH:mm:ss}  gym={a.GymId}  enroll={a.EnrollNumber}  event_time={a.EventTime}"))}</pre>

<h3>Last heartbeats</h3>
<pre>{string.Join("\n", lastHeartbeat.Select(kv => $"{kv.Key}: {kv.Value.Status} @ {kv.Value.At:HH:mm:ss}"))}</pre>
</body></html>
""", "text/html"));

app.MapPost("/test/queue", (HttpRequest req) =>
{
    var form = req.Form;
    var cmd = new CommandRecord(
        nextCommandId++,
        form["gymId"].ToString(),
        form["commandType"].ToString(),
        form["enrollNumber"].ToString(),
        form["memberName"].ToString(),
        5
    );
    pendingCommands.Enqueue(cmd);
    commandLog.Add(cmd);
    Console.WriteLine($"[queued] {cmd.CommandType} for enroll={cmd.EnrollNumber} gym={cmd.GymId}");
    return Results.Redirect("/");
});

Console.WriteLine("Mock Renewal Desk API running at http://localhost:5080");
Console.WriteLine("Open that URL in a browser to manually queue test commands.");
app.Run();

// ---- request/record types ----
record HeartbeatRequest(string? gymId, string? status, DateTime? timestamp);
record AttendanceRequest(string gymId, string deviceEnrollNumber, DateTime eventTime, int verifyMethod, bool isInvalid);
record AckRequest(string status, string? errorMessage);
record EnrollmentConfirmRequest(string memberId, string deviceEnrollNumber, string gymId);

record CommandRecord(int Id, string GymId, string CommandType, string EnrollNumber, string? MemberName, int? DelaySeconds);
record AttendanceRecord(string GymId, string EnrollNumber, DateTime EventTime, int VerifyMethod, bool IsInvalid, DateTime ReceivedAt);
record HeartbeatRecord(string Status, DateTime At);
