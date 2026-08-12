using System;
using System.Data.SQLite;
using System.IO;
using System.Collections.Generic;

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
                            original_uses_group_time_zone INTEGER NULL,
                            deny_time_zone_id INTEGER NOT NULL,
                            applied_deny_time_zones TEXT NULL,
                            applied_deny_uses_group_time_zone INTEGER NULL,
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

                // Existing client laptops may already have earlier schemas. Add
                // semantic state columns without changing any saved recovery
                // record. A NULL semantic field deliberately marks a legacy
                // record as requiring manual review; it is never guessed.
                EnsureUserTimeZoneBackupColumn(connection,
                    "applied_deny_time_zones TEXT NULL", "applied_deny_time_zones");
                EnsureUserTimeZoneBackupColumn(connection,
                    "original_uses_group_time_zone INTEGER NULL", "original_uses_group_time_zone");
                EnsureUserTimeZoneBackupColumn(connection,
                    "applied_deny_uses_group_time_zone INTEGER NULL", "applied_deny_uses_group_time_zone");
            }
        }

        private static void EnsureUserTimeZoneBackupColumn(SQLiteConnection connection,
                                                            string columnDefinition,
                                                            string columnName)
        {
            bool exists = false;
            using (var tableInfo = connection.CreateCommand())
            {
                tableInfo.CommandText = "PRAGMA table_info(user_time_zone_backups)";
                using (var reader = tableInfo.ExecuteReader())
                {
                    while (reader.Read())
                    {
                        if (string.Equals(reader.GetString(1), columnName,
                                          StringComparison.OrdinalIgnoreCase))
                        {
                            exists = true;
                            break;
                        }
                    }
                }
            }

            if (exists) return;

            using (var migration = connection.CreateCommand())
            {
                migration.CommandText =
                    "ALTER TABLE user_time_zone_backups ADD COLUMN " + columnDefinition;
                migration.ExecuteNonQuery();
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
                        SELECT original_time_zones, original_uses_group_time_zone,
                               deny_time_zone_id, applied_deny_time_zones,
                               applied_deny_uses_group_time_zone, created_at_utc
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
                            OriginalUsesGroupTimeZone = reader.IsDBNull(1)
                                ? (bool?)null
                                : reader.GetInt32(1) != 0,
                            DenyTimeZoneId = reader.GetInt32(2),
                            AppliedDenyTimeZones = reader.IsDBNull(3) ? null : reader.GetString(3),
                            AppliedDenyUsesGroupTimeZone = reader.IsDBNull(4)
                                ? (bool?)null
                                : reader.GetInt32(4) != 0,
                            CreatedAtUtc = DateTime.Parse(reader.GetString(5)).ToUniversalTime()
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
                            (device_serial, enroll_number, original_time_zones,
                             original_uses_group_time_zone, deny_time_zone_id,
                             applied_deny_time_zones, applied_deny_uses_group_time_zone, created_at_utc)
                        VALUES (@serial, @enroll, @original, @originalUsesGroup, @denyId,
                                @appliedDeny, @appliedDenyUsesGroup, @created)";
                    command.Parameters.AddWithValue("@serial", backup.DeviceSerial);
                    command.Parameters.AddWithValue("@enroll", backup.EnrollNumber);
                    command.Parameters.AddWithValue("@original", backup.OriginalTimeZones);
                    command.Parameters.AddWithValue("@originalUsesGroup",
                                                    backup.OriginalUsesGroupTimeZone.HasValue
                                                        ? (object)(backup.OriginalUsesGroupTimeZone.Value ? 1 : 0)
                                                        : DBNull.Value);
                    command.Parameters.AddWithValue("@denyId", backup.DenyTimeZoneId);
                    command.Parameters.AddWithValue("@appliedDeny",
                                                    (object)backup.AppliedDenyTimeZones ?? DBNull.Value);
                    command.Parameters.AddWithValue("@appliedDenyUsesGroup",
                                                    backup.AppliedDenyUsesGroupTimeZone.HasValue
                                                        ? (object)(backup.AppliedDenyUsesGroupTimeZone.Value ? 1 : 0)
                                                        : DBNull.Value);
                    command.Parameters.AddWithValue("@created", backup.CreatedAtUtc.ToString("o"));
                    return command.ExecuteNonQuery() == 1;
                }
            }
        }

        /// <summary>
        /// Records the exact raw schedule the terminal returned after a successful
        /// deny write.  The restore path must not guess a different dialect.
        /// </summary>
        public bool TryMarkUserTimeZoneDenyApplied(string deviceSerial, string enrollNumber,
                                                   string appliedDenyTimeZones,
                                                   bool appliedDenyUsesGroupTimeZone)
        {
            if (string.IsNullOrWhiteSpace(appliedDenyTimeZones) || appliedDenyUsesGroupTimeZone)
                return false;

            using (var connection = new SQLiteConnection(_connectionString))
            {
                connection.Open();
                using (var command = connection.CreateCommand())
                {
                    command.CommandText = @"
                        UPDATE user_time_zone_backups
                        SET applied_deny_time_zones = @appliedDeny,
                            applied_deny_uses_group_time_zone = @appliedDenyUsesGroup
                        WHERE device_serial = @serial
                          AND enroll_number = @enroll
                          AND applied_deny_time_zones IS NULL";
                    command.Parameters.AddWithValue("@serial", deviceSerial);
                    command.Parameters.AddWithValue("@enroll", enrollNumber);
                    command.Parameters.AddWithValue("@appliedDeny", appliedDenyTimeZones);
                    command.Parameters.AddWithValue("@appliedDenyUsesGroup", 0);
                    return command.ExecuteNonQuery() == 1;
                }
            }
        }

        /// <summary>
        /// Returns only recovery records for which the bridge previously persisted a
        /// semantically verified personal deny assignment.  This is used to make the
        /// operator's physical-door confirmation meaningful: a prepared global time
        /// zone alone must never unlock automatic expiry.
        /// </summary>
        public List<UserTimeZoneBackup> GetAppliedDenyBackups(string deviceSerial)
        {
            var backups = new List<UserTimeZoneBackup>();
            using (var connection = new SQLiteConnection(_connectionString))
            {
                connection.Open();
                using (var command = connection.CreateCommand())
                {
                    command.CommandText = @"
                        SELECT enroll_number, original_time_zones,
                               original_uses_group_time_zone, deny_time_zone_id,
                               applied_deny_time_zones, applied_deny_uses_group_time_zone,
                               created_at_utc
                        FROM user_time_zone_backups
                        WHERE device_serial = @serial
                          AND applied_deny_time_zones IS NOT NULL
                          AND applied_deny_uses_group_time_zone = 0";
                    command.Parameters.AddWithValue("@serial", deviceSerial);

                    using (var reader = command.ExecuteReader())
                    {
                        while (reader.Read())
                        {
                            backups.Add(new UserTimeZoneBackup
                            {
                                DeviceSerial = deviceSerial,
                                EnrollNumber = reader.GetString(0),
                                OriginalTimeZones = reader.GetString(1),
                                OriginalUsesGroupTimeZone = reader.IsDBNull(2)
                                    ? (bool?)null
                                    : reader.GetInt32(2) != 0,
                                DenyTimeZoneId = reader.GetInt32(3),
                                AppliedDenyTimeZones = reader.GetString(4),
                                AppliedDenyUsesGroupTimeZone = reader.GetInt32(5) != 0,
                                CreatedAtUtc = DateTime.Parse(reader.GetString(6)).ToUniversalTime()
                            });
                        }
                    }
                }
            }

            return backups;
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

        public void DeleteTimeZonePolicyBackup(string deviceSerial, int denyTimeZoneId)
        {
            using (var connection = new SQLiteConnection(_connectionString))
            {
                connection.Open();
                using (var command = connection.CreateCommand())
                {
                    command.CommandText = @"
                        DELETE FROM time_zone_policy_backups
                        WHERE device_serial = @serial AND deny_time_zone_id = @denyId";
                    command.Parameters.AddWithValue("@serial", deviceSerial);
                    command.Parameters.AddWithValue("@denyId", denyTimeZoneId);
                    command.ExecuteNonQuery();
                }
            }
        }
    }

    public sealed class UserTimeZoneBackup
    {
        public string DeviceSerial { get; set; }
        public string EnrollNumber { get; set; }
        public string OriginalTimeZones { get; set; }
        public bool? OriginalUsesGroupTimeZone { get; set; }
        public int DenyTimeZoneId { get; set; }
        public string AppliedDenyTimeZones { get; set; }
        public bool? AppliedDenyUsesGroupTimeZone { get; set; }
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
