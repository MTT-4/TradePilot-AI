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

BACKUP_DIR="${1:-}"
CONFIRM_FLAG="${2:-}"

if [[ -z "$BACKUP_DIR" ]]; then
  echo "Usage: bash tools/ops/restore_local.sh <backup_dir> --yes"
  exit 1
fi

if [[ "$CONFIRM_FLAG" != "--yes" ]]; then
  echo "Refusing to restore without explicit confirmation. Re-run with --yes."
  exit 1
fi

DUMP_FILE="$BACKUP_DIR/db/tradepilot.dump"
OBJECT_STORE_DIR="$BACKUP_DIR/object-store/$S3_BUCKET"

if [[ ! -f "$DUMP_FILE" ]]; then
  echo "Backup dump not found: $DUMP_FILE"
  exit 1
fi

echo "Ensuring pgvector extension exists before restore"
psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null

echo "Restoring PostgreSQL dump from $DUMP_FILE"
pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --dbname "$DATABASE_URL" \
  "$DUMP_FILE"

if [[ -d "$OBJECT_STORE_DIR" ]]; then
  echo "Restoring object store from $OBJECT_STORE_DIR"
  mc alias set tradepilot-local "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null
  mc mirror --overwrite "$OBJECT_STORE_DIR" "tradepilot-local/$S3_BUCKET"
fi

echo "Restore completed from: $BACKUP_DIR"
