#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${S3_ENDPOINT:?S3_ENDPOINT is required}"
: "${S3_BUCKET:?S3_BUCKET is required}"
: "${S3_ACCESS_KEY:?S3_ACCESS_KEY is required}"
: "${S3_SECRET_KEY:?S3_SECRET_KEY is required}"

TIMESTAMP="$(date +"%Y%m%d-%H%M%S")"
TARGET_DIR="${1:-$ROOT_DIR/backups/$TIMESTAMP}"

mkdir -p "$TARGET_DIR/db" "$TARGET_DIR/object-store"

echo "Creating PostgreSQL backup at $TARGET_DIR/db/tradepilot.dump"
pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file "$TARGET_DIR/db/tradepilot.dump" \
  "$DATABASE_URL"

echo "Exporting schema snapshot at $TARGET_DIR/db/schema.sql"
pg_dump \
  --schema-only \
  --no-owner \
  --no-privileges \
  --file "$TARGET_DIR/db/schema.sql" \
  "$DATABASE_URL"

echo "Mirroring object storage bucket to $TARGET_DIR/object-store/$S3_BUCKET"
mc alias set tradepilot-local "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null
mc mirror "tradepilot-local/$S3_BUCKET" "$TARGET_DIR/object-store/$S3_BUCKET"

cat > "$TARGET_DIR/manifest.json" <<EOF
{
  "createdAt": "$TIMESTAMP",
  "databaseDump": "db/tradepilot.dump",
  "schemaSnapshot": "db/schema.sql",
  "objectStorePath": "object-store/$S3_BUCKET"
}
EOF

echo "Backup completed: $TARGET_DIR"
