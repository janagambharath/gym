using System;
using System.Data.SQLite;
using System.IO;

namespace RenewalDeskBridge.AccessControl
{
    /// <summary>
    /// Durable local state for membership access.  It is intentionally separate from
    /// the attendance outbox so a recovery of queued attendance cannot erase the exact
    /// device time-zone settings needed to restore a member safely.
    /// </summary>
    public sealed class AccessStateStore
    {
        private readonly string _connectionString;

        public AccessStateStore()
        {
            string dbPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "access_state.db");
            _connectionString = $"Data Source={dbPath};Version=3;";
            EnsureSchema();
        }

        private void EnsureSchema()
        {
            using (var connection = new SQLiteConnection(_connectionString))
            {
                connection.Open();
                using (var command = connection.CreateCommand())
                {
                    command.CommandText = @"
                        CREATE TABLE IF NOT EXISTS user_time_zone_backups (
                            device_serial TEXT NOT NULL,
                            enroll_number TEXT NOT NULL,
                            original_time_zones TEXT NOT NULL,
                            deny_time_zone_id INTEGER NOT NULL,
                            created_at_utc TEXT NOT NULL,
                            PRIMARY KEY (device_serial, enroll_number)
                        );

                        CREATE TABLE IF NOT EXISTS time_zone_policy_backups (
                            device_serial TEXT NOT NULL,
                            deny_time_zone_id INTEGER NOT NULL,
                            original_definition TEXT NOT NULL,
                            deny_definition TEXT NOT NULL,
                            prepared_at_utc TEXT NOT NULL,
                            PRIMARY KEY (device_serial, deny_time_zone_id)
                        );";
                    command.ExecuteNonQuery();
                }
            }
        }

        public UserTimeZoneBackup GetUserTimeZoneBackup(string deviceSerial, string enrollNumber)
        {
            using (var connection = new SQLiteConnection(_connectionString))
            {
                connection.Open();
                using (var command = connection.CreateCommand())
                {
                    command.CommandText = @"
                        SELECT original_time_zones, deny_time_zone_id, created_at_utc
                        FROM user_time_zone_backups
                        WHERE device_serial = @serial AND enroll_number = @enroll";
                    command.Parameters.AddWithValue("@serial", deviceSerial);
                    command.Parameters.AddWithValue("@enroll", enrollNumber);

                    using (var reader = command.ExecuteReader())
                    {
                        if (!reader.Read()) return null;

                        return new UserTimeZoneBackup
                        {
                            DeviceSerial = deviceSerial,
                            EnrollNumber = enrollNumber,
                            OriginalTimeZones = reader.GetString(0),
                            DenyTimeZoneId = reader.GetInt32(1),
                            CreatedAtUtc = DateTime.Parse(reader.GetString(2)).ToUniversalTime()
                        };
                    }
                }
            }
        }

        /// <summary>
        /// Inserts only once.  Repeated expiry commands must never overwrite the
        /// original access schedule that is needed when the member renews.
        /// </summary>
        public bool TryCreateUserTimeZoneBackup(UserTimeZoneBackup backup)
        {
            using (var connection = new SQLiteConnection(_connectionString))
            {
                connection.Open();
                using (var command = connection.CreateCommand())
                {
                    command.CommandText = @"
                        INSERT OR IGNORE INTO user_time_zone_backups
                            (device_serial, enroll_number, original_time_zones, deny_time_zone_id, created_at_utc)
                        VALUES (@serial, @enroll, @original, @denyId, @created)";
                    command.Parameters.AddWithValue("@serial", backup.DeviceSerial);
                    command.Parameters.AddWithValue("@enroll", backup.EnrollNumber);
                    command.Parameters.AddWithValue("@original", backup.OriginalTimeZones);
                    command.Parameters.AddWithValue("@denyId", backup.DenyTimeZoneId);
                    command.Parameters.AddWithValue("@created", backup.CreatedAtUtc.ToString("o"));
                    return command.ExecuteNonQuery() == 1;
                }
            }
        }

        public void DeleteUserTimeZoneBackup(string deviceSerial, string enrollNumber)
        {
            using (var connection = new SQLiteConnection(_connectionString))
            {
                connection.Open();
                using (var command = connection.CreateCommand())
                {
                    command.CommandText = @"
                        DELETE FROM user_time_zone_backups
                        WHERE device_serial = @serial AND enroll_number = @enroll";
                    command.Parameters.AddWithValue("@serial", deviceSerial);
                    command.Parameters.AddWithValue("@enroll", enrollNumber);
                    command.ExecuteNonQuery();
                }
            }
        }

        public TimeZonePolicyBackup GetTimeZonePolicyBackup(string deviceSerial, int denyTimeZoneId)
        {
            using (var connection = new SQLiteConnection(_connectionString))
            {
                connection.Open();
                using (var command = connection.CreateCommand())
                {
                    command.CommandText = @"
                        SELECT original_definition, deny_definition, prepared_at_utc
                        FROM time_zone_policy_backups
                        WHERE device_serial = @serial AND deny_time_zone_id = @denyId";
                    command.Parameters.AddWithValue("@serial", deviceSerial);
                    command.Parameters.AddWithValue("@denyId", denyTimeZoneId);

                    using (var reader = command.ExecuteReader())
                    {
                        if (!reader.Read()) return null;

                        return new TimeZonePolicyBackup
                        {
                            DeviceSerial = deviceSerial,
                            DenyTimeZoneId = denyTimeZoneId,
                            OriginalDefinition = reader.GetString(0),
                            DenyDefinition = reader.GetString(1),
                            PreparedAtUtc = DateTime.Parse(reader.GetString(2)).ToUniversalTime()
                        };
                    }
                }
            }
        }

        /// <summary>Stores the original global slot before the bridge changes it.</summary>
        public bool TryCreateTimeZonePolicyBackup(TimeZonePolicyBackup backup)
        {
            using (var connection = new SQLiteConnection(_connectionString))
            {
                connection.Open();
                using (var command = connection.CreateCommand())
                {
                    command.CommandText = @"
                        INSERT OR IGNORE INTO time_zone_policy_backups
                            (device_serial, deny_time_zone_id, original_definition, deny_definition, prepared_at_utc)
                        VALUES (@serial, @denyId, @original, @deny, @prepared)";
                    command.Parameters.AddWithValue("@serial", backup.DeviceSerial);
                    command.Parameters.AddWithValue("@denyId", backup.DenyTimeZoneId);
                    command.Parameters.AddWithValue("@original", backup.OriginalDefinition);
                    command.Parameters.AddWithValue("@deny", backup.DenyDefinition);
                    command.Parameters.AddWithValue("@prepared", backup.PreparedAtUtc.ToString("o"));
                    return command.ExecuteNonQuery() == 1;
                }
            }
        }
    }

    public sealed class UserTimeZoneBackup
    {
        public string DeviceSerial { get; set; }
        public string EnrollNumber { get; set; }
        public string OriginalTimeZones { get; set; }
        public int DenyTimeZoneId { get; set; }
        public DateTime CreatedAtUtc { get; set; }
    }

    public sealed class TimeZonePolicyBackup
    {
        public string DeviceSerial { get; set; }
        public int DenyTimeZoneId { get; set; }
        public string OriginalDefinition { get; set; }
        public string DenyDefinition { get; set; }
        public DateTime PreparedAtUtc { get; set; }
    }
}
