using System;
using System.Collections.Generic;
using System.Data.SQLite;
using System.Globalization;
using System.IO;

namespace RenewalDeskBridge.Queue
{
    /// <summary>
    /// A small local SQLite store used for two durability boundaries:
    ///
    /// 1. Attendance is written before it is uploaded, so an internet outage cannot
    ///    lose a scan.  Each stored scan has a stable event ID for API idempotency.
    /// 2. A command result is written before it is acknowledged, so an expired lease
    ///    or lost acknowledgement cannot make the bridge execute the same command ID
    ///    against the biometric device twice.
    /// </summary>
    public class LocalOutbox
    {
        private readonly string _connectionString;
        // The UI scan callback and background uploader share this one database.
        // SQLite permits one writer at a time, so serialize their local operations
        // rather than letting a legitimate scan race MarkSent and surface a lock.
        private readonly object _databaseLock = new object();

        public LocalOutbox()
        {
            string dbPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "outbox.db");
            _connectionString = $"Data Source={dbPath};Version=3;Default Timeout=5;";
            EnsureSchema();
        }

        private void EnsureSchema()
        {
            using (var conn = new SQLiteConnection(_connectionString))
            {
                conn.Open();
                using (var transaction = conn.BeginTransaction())
                {
                    ExecuteNonQuery(conn, transaction, @"
                        CREATE TABLE IF NOT EXISTS attendance_outbox (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            event_id TEXT,
                            enroll_number TEXT NOT NULL,
                            event_time TEXT NOT NULL,
                            verify_method INTEGER NOT NULL,
                            is_invalid INTEGER NOT NULL,
                            created_at TEXT NOT NULL,
                            sent INTEGER NOT NULL DEFAULT 0
                        );

                        CREATE TABLE IF NOT EXISTS command_receipts (
                            command_id TEXT PRIMARY KEY,
                            command_type TEXT,
                            enroll_number TEXT,
                            status TEXT NOT NULL,
                            result_message TEXT,
                            lease_token TEXT,
                            completed_at TEXT NOT NULL
                        );
                    ");

                    // Existing client installations already have attendance_outbox
                    // without event_id.  SQLite cannot add a NOT NULL column safely
                    // here, so add it nullable, backfill every row transactionally,
                    // then enforce uniqueness with an index.
                    EnsureColumn(conn, transaction, "attendance_outbox", "event_id", "TEXT");
                    BackfillAttendanceEventIds(conn, transaction);

                    ExecuteNonQuery(conn, transaction, @"
                        CREATE INDEX IF NOT EXISTS idx_outbox_sent ON attendance_outbox(sent);
                        CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_event_id ON attendance_outbox(event_id);
                        CREATE INDEX IF NOT EXISTS idx_command_receipts_completed_at
                            ON command_receipts(completed_at);
                    ");

                    transaction.Commit();
                }
            }
        }

        private static void EnsureColumn(SQLiteConnection conn, SQLiteTransaction transaction,
                                         string tableName, string columnName, string columnDefinition)
        {
            using (var cmd = conn.CreateCommand())
            {
                cmd.Transaction = transaction;
                cmd.CommandText = "PRAGMA table_info(" + tableName + ")";
                using (var reader = cmd.ExecuteReader())
                {
                    while (reader.Read())
                    {
                        string existingName = reader["name"] as string;
                        if (string.Equals(existingName, columnName, StringComparison.OrdinalIgnoreCase))
                        {
                            return;
                        }
                    }
                }
            }

            ExecuteNonQuery(conn, transaction,
                "ALTER TABLE " + tableName + " ADD COLUMN " + columnName + " " + columnDefinition);
        }

        private static void BackfillAttendanceEventIds(SQLiteConnection conn, SQLiteTransaction transaction)
        {
            var rowsToRepair = new List<int>();
            var usedEventIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            using (var cmd = conn.CreateCommand())
            {
                cmd.Transaction = transaction;
                cmd.CommandText = "SELECT id, event_id FROM attendance_outbox ORDER BY id ASC";
                using (var reader = cmd.ExecuteReader())
                {
                    while (reader.Read())
                    {
                        int id = reader.GetInt32(0);
                        string eventId = reader.IsDBNull(1) ? null : reader.GetString(1).Trim();

                        if (string.IsNullOrEmpty(eventId) || !usedEventIds.Add(eventId))
                        {
                            rowsToRepair.Add(id);
                        }
                    }
                }
            }

            foreach (int id in rowsToRepair)
            {
                string eventId;
                do
                {
                    eventId = Guid.NewGuid().ToString("D");
                }
                while (!usedEventIds.Add(eventId));

                using (var cmd = conn.CreateCommand())
                {
                    cmd.Transaction = transaction;
                    cmd.CommandText = "UPDATE attendance_outbox SET event_id = @eventId WHERE id = @id";
                    cmd.Parameters.AddWithValue("@eventId", eventId);
                    cmd.Parameters.AddWithValue("@id", id);
                    cmd.ExecuteNonQuery();
                }
            }
        }

        private static void ExecuteNonQuery(SQLiteConnection conn, SQLiteTransaction transaction, string sql)
        {
            using (var cmd = conn.CreateCommand())
            {
                cmd.Transaction = transaction;
                cmd.CommandText = sql;
                cmd.ExecuteNonQuery();
            }
        }

        /// <summary>
        /// Persists a scan before it is sent.  The generated event ID is never changed
        /// by retry logic, which is what makes an at-least-once HTTP upload safe.
        /// </summary>
        public string Enqueue(string enrollNumber, DateTime eventTime, int verifyMethod, bool isInvalid)
        {
            lock (_databaseLock)
            {
                string eventId = Guid.NewGuid().ToString("D");
                using (var conn = new SQLiteConnection(_connectionString))
                {
                    conn.Open();
                    var cmd = conn.CreateCommand();
                    cmd.CommandText = @"
                    INSERT INTO attendance_outbox
                        (event_id, enroll_number, event_time, verify_method, is_invalid, created_at, sent)
                    VALUES (@eventId, @enroll, @time, @method, @invalid, @created, 0)";
                    cmd.Parameters.AddWithValue("@eventId", eventId);
                    cmd.Parameters.AddWithValue("@enroll", enrollNumber);
                    cmd.Parameters.AddWithValue("@time", eventTime.ToString("o", CultureInfo.InvariantCulture));
                    cmd.Parameters.AddWithValue("@method", verifyMethod);
                    cmd.Parameters.AddWithValue("@invalid", isInvalid ? 1 : 0);
                    cmd.Parameters.AddWithValue("@created", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture));
                    cmd.ExecuteNonQuery();
                }
                return eventId;
            }
        }

        public List<OutboxRow> GetUnsent(int limit = 50)
        {
            lock (_databaseLock)
            {
                var rows = new List<OutboxRow>();
                using (var conn = new SQLiteConnection(_connectionString))
                {
                    conn.Open();
                    var cmd = conn.CreateCommand();
                    cmd.CommandText = "SELECT id, event_id, enroll_number, event_time, verify_method, is_invalid " +
                                  "FROM attendance_outbox WHERE sent = 0 ORDER BY id ASC LIMIT @limit";
                    cmd.Parameters.AddWithValue("@limit", limit);

                    using (var reader = cmd.ExecuteReader())
                    {
                        while (reader.Read())
                        {
                            rows.Add(new OutboxRow
                            {
                                Id = reader.GetInt32(0),
                                EventId = reader.GetString(1),
                                EnrollNumber = reader.GetString(2),
                                EventTime = DateTime.Parse(reader.GetString(3), CultureInfo.InvariantCulture,
                                                           DateTimeStyles.RoundtripKind),
                                VerifyMethod = reader.GetInt32(4),
                                IsInvalid = reader.GetInt32(5) == 1
                            });
                        }
                    }
                }
                return rows;
            }
        }

        public void MarkSent(int id)
        {
            lock (_databaseLock)
            {
                using (var conn = new SQLiteConnection(_connectionString))
                {
                    conn.Open();
                    var cmd = conn.CreateCommand();
                    cmd.CommandText = "UPDATE attendance_outbox SET sent = 1 WHERE id = @id";
                    cmd.Parameters.AddWithValue("@id", id);
                    cmd.ExecuteNonQuery();
                }
            }
        }

        /// <summary>
        /// Gets the durable outcome of a previously executed command.  Receipt lookup
        /// happens before device I/O, so a redelivered command ID gets re-acknowledged
        /// rather than executed again.
        /// </summary>
        public bool TryGetCommandReceipt(string commandId, out CommandReceipt receipt)
        {
            receipt = null;
            if (string.IsNullOrWhiteSpace(commandId)) return false;

            lock (_databaseLock)
            {
                using (var conn = new SQLiteConnection(_connectionString))
                {
                    conn.Open();
                    var cmd = conn.CreateCommand();
                    cmd.CommandText = @"
                    SELECT command_id, command_type, enroll_number, status, result_message,
                           lease_token, completed_at
                    FROM command_receipts
                    WHERE command_id = @commandId
                    LIMIT 1";
                    cmd.Parameters.AddWithValue("@commandId", commandId);

                    using (var reader = cmd.ExecuteReader())
                    {
                        if (!reader.Read()) return false;

                        receipt = new CommandReceipt
                        {
                            CommandId = reader.GetString(0),
                            CommandType = reader.IsDBNull(1) ? null : reader.GetString(1),
                            EnrollNumber = reader.IsDBNull(2) ? null : reader.GetString(2),
                            Status = reader.GetString(3),
                            ResultMessage = reader.IsDBNull(4) ? null : reader.GetString(4),
                            LeaseToken = reader.IsDBNull(5) ? null : reader.GetString(5),
                            CompletedAtUtc = DateTime.Parse(reader.GetString(6), CultureInfo.InvariantCulture,
                                                            DateTimeStyles.RoundtripKind)
                        };
                        return true;
                    }
                }
            }
        }

        /// <summary>
        /// Stores the command outcome before an HTTP acknowledgement is attempted.
        /// Returns false if another loop/process has already stored the same ID; in
        /// that case callers must read and reuse the existing receipt.
        /// </summary>
        public bool TryRecordCommandReceipt(CommandReceipt receipt)
        {
            if (receipt == null) throw new ArgumentNullException(nameof(receipt));
            if (string.IsNullOrWhiteSpace(receipt.CommandId))
                throw new ArgumentException("A command receipt requires a command ID.", nameof(receipt));
            if (string.IsNullOrWhiteSpace(receipt.Status))
                throw new ArgumentException("A command receipt requires a status.", nameof(receipt));

            lock (_databaseLock)
            {
                using (var conn = new SQLiteConnection(_connectionString))
                {
                    conn.Open();
                    var cmd = conn.CreateCommand();
                    cmd.CommandText = @"
                    INSERT OR IGNORE INTO command_receipts
                        (command_id, command_type, enroll_number, status, result_message,
                         lease_token, completed_at)
                    VALUES (@commandId, @commandType, @enrollNumber, @status, @resultMessage,
                            @leaseToken, @completedAt)";
                    cmd.Parameters.AddWithValue("@commandId", receipt.CommandId);
                    cmd.Parameters.AddWithValue("@commandType", (object)receipt.CommandType ?? DBNull.Value);
                    cmd.Parameters.AddWithValue("@enrollNumber", (object)receipt.EnrollNumber ?? DBNull.Value);
                    cmd.Parameters.AddWithValue("@status", receipt.Status);
                    cmd.Parameters.AddWithValue("@resultMessage", (object)receipt.ResultMessage ?? DBNull.Value);
                    cmd.Parameters.AddWithValue("@leaseToken", (object)receipt.LeaseToken ?? DBNull.Value);
                    cmd.Parameters.AddWithValue("@completedAt", receipt.CompletedAtUtc.ToString("o", CultureInfo.InvariantCulture));
                    return cmd.ExecuteNonQuery() == 1;
                }
            }
        }

        /// <summary>Housekeeping - call occasionally so the outbox.db file doesn't grow forever.</summary>
        public void PurgeSentOlderThan(TimeSpan age)
        {
            lock (_databaseLock)
            {
                using (var conn = new SQLiteConnection(_connectionString))
                {
                    conn.Open();
                    var cmd = conn.CreateCommand();
                    cmd.CommandText = "DELETE FROM attendance_outbox WHERE sent = 1 AND created_at < @cutoff";
                    cmd.Parameters.AddWithValue("@cutoff", (DateTime.UtcNow - age).ToString("o", CultureInfo.InvariantCulture));
                    cmd.ExecuteNonQuery();
                }
            }
        }
    }

    public class OutboxRow
    {
        public int Id { get; set; }
        public string EventId { get; set; }
        public string EnrollNumber { get; set; }
        public DateTime EventTime { get; set; }
        public int VerifyMethod { get; set; }
        public bool IsInvalid { get; set; }
    }

    public class CommandReceipt
    {
        public string CommandId { get; set; }
        public string CommandType { get; set; }
        public string EnrollNumber { get; set; }
        public string Status { get; set; }
        public string ResultMessage { get; set; }
        public string LeaseToken { get; set; }
        public DateTime CompletedAtUtc { get; set; }
    }
}
