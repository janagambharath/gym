using System;
using System.Collections.Generic;
using System.Data.SQLite;
using System.IO;

namespace RenewalDeskBridge.Queue
{
    /// <summary>
    /// A tiny local SQLite file that buffers attendance events when the internet is down,
    /// so a scan at the door is never silently lost just because WiFi hiccuped.
    ///
    /// This is deliberately simple - one table, no migrations framework, because this
    /// bridge's whole job is to be boring and reliable, not clever.
    /// </summary>
    public class LocalOutbox
    {
        private readonly string _connectionString;

        public LocalOutbox()
        {
            string dbPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "outbox.db");
            _connectionString = $"Data Source={dbPath};Version=3;";
            EnsureSchema();
        }

        private void EnsureSchema()
        {
            using (var conn = new SQLiteConnection(_connectionString))
            {
                conn.Open();
                var cmd = conn.CreateCommand();
                cmd.CommandText = @"
                    CREATE TABLE IF NOT EXISTS attendance_outbox (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        enroll_number TEXT NOT NULL,
                        event_time TEXT NOT NULL,
                        verify_method INTEGER NOT NULL,
                        is_invalid INTEGER NOT NULL,
                        created_at TEXT NOT NULL,
                        sent INTEGER NOT NULL DEFAULT 0
                    );
                    CREATE INDEX IF NOT EXISTS idx_outbox_sent ON attendance_outbox(sent);
                ";
                cmd.ExecuteNonQuery();
            }
        }

        public void Enqueue(string enrollNumber, DateTime eventTime, int verifyMethod, bool isInvalid)
        {
            using (var conn = new SQLiteConnection(_connectionString))
            {
                conn.Open();
                var cmd = conn.CreateCommand();
                cmd.CommandText = @"
                    INSERT INTO attendance_outbox
                        (enroll_number, event_time, verify_method, is_invalid, created_at, sent)
                    VALUES (@enroll, @time, @method, @invalid, @created, 0)";
                cmd.Parameters.AddWithValue("@enroll", enrollNumber);
                cmd.Parameters.AddWithValue("@time", eventTime.ToString("o"));
                cmd.Parameters.AddWithValue("@method", verifyMethod);
                cmd.Parameters.AddWithValue("@invalid", isInvalid ? 1 : 0);
                cmd.Parameters.AddWithValue("@created", DateTime.UtcNow.ToString("o"));
                cmd.ExecuteNonQuery();
            }
        }

        public List<OutboxRow> GetUnsent(int limit = 50)
        {
            var rows = new List<OutboxRow>();
            using (var conn = new SQLiteConnection(_connectionString))
            {
                conn.Open();
                var cmd = conn.CreateCommand();
                cmd.CommandText = "SELECT id, enroll_number, event_time, verify_method, is_invalid " +
                                   "FROM attendance_outbox WHERE sent = 0 ORDER BY id ASC LIMIT @limit";
                cmd.Parameters.AddWithValue("@limit", limit);

                using (var reader = cmd.ExecuteReader())
                {
                    while (reader.Read())
                    {
                        rows.Add(new OutboxRow
                        {
                            Id = reader.GetInt32(0),
                            EnrollNumber = reader.GetString(1),
                            EventTime = DateTime.Parse(reader.GetString(2)),
                            VerifyMethod = reader.GetInt32(3),
                            IsInvalid = reader.GetInt32(4) == 1
                        });
                    }
                }
            }
            return rows;
        }

        public void MarkSent(int id)
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

        /// <summary>Housekeeping - call occasionally so the outbox.db file doesn't grow forever.</summary>
        public void PurgeSentOlderThan(TimeSpan age)
        {
            using (var conn = new SQLiteConnection(_connectionString))
            {
                conn.Open();
                var cmd = conn.CreateCommand();
                cmd.CommandText = "DELETE FROM attendance_outbox WHERE sent = 1 AND created_at < @cutoff";
                cmd.Parameters.AddWithValue("@cutoff", (DateTime.UtcNow - age).ToString("o"));
                cmd.ExecuteNonQuery();
            }
        }
    }

    public class OutboxRow
    {
        public int Id { get; set; }
        public string EnrollNumber { get; set; }
        public DateTime EventTime { get; set; }
        public int VerifyMethod { get; set; }
        public bool IsInvalid { get; set; }
    }
}
