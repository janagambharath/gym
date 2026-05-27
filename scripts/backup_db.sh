#!/usr/bin/env bash
set -euo pipefail

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="renewaldesk_${TIMESTAMP}.dump"
S3_BUCKET="${AWS_S3_BUCKET:-}"
S3_PREFIX="${AWS_S3_BACKUP_PREFIX:-db-backups}"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL not set"
  exit 1
fi

echo "Starting backup: $BACKUP_FILE"
pg_dump --format=custom --no-acl --no-owner "$DATABASE_URL" > "/tmp/$BACKUP_FILE"

if [ -n "$S3_BUCKET" ]; then
  if ! command -v aws >/dev/null 2>&1; then
    echo "ERROR: AWS_S3_BUCKET is set but aws CLI is not installed"
    exit 1
  fi
  aws s3 cp "/tmp/$BACKUP_FILE" "s3://${S3_BUCKET}/${S3_PREFIX}/${BACKUP_FILE}"
  echo "Backup uploaded to s3://${S3_BUCKET}/${S3_PREFIX}/${BACKUP_FILE}"
fi

rm -f "/tmp/$BACKUP_FILE"
echo "Backup complete"
