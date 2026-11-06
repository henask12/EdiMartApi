#!/usr/bin/env bash
# Daily / ad-hoc Postgres backup for EdiMart.
# Uses DATABASE_URL. When S3_* env vars are set, uploads the dump and prunes old
# objects by BACKUP_RETENTION_DAYS (default 14).
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$OUT_DIR"
FILE="${OUT_DIR}/edimart-${STAMP}.dump"

echo "Dumping database to ${FILE}"
pg_dump --format=custom --no-owner --no-acl --dbname="$DATABASE_URL" --file="$FILE"
echo "Local dump ready: ${FILE} ($(du -h "$FILE" | cut -f1))"

if [[ -n "${S3_BUCKET:-}" && -n "${S3_ACCESS_KEY_ID:-}" && -n "${S3_SECRET_ACCESS_KEY:-}" ]]; then
  REGION="${S3_REGION:-auto}"
  ENDPOINT_ARGS=()
  if [[ -n "${S3_ENDPOINT:-}" ]]; then
    ENDPOINT_ARGS+=(--endpoint-url "$S3_ENDPOINT")
  fi
  if [[ "${S3_FORCE_PATH_STYLE:-0}" == "1" ]]; then
    export AWS_S3_FORCE_PATH_STYLE=true
  fi
  export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
  export AWS_DEFAULT_REGION="$REGION"
  KEY_PREFIX="${BACKUP_S3_PREFIX:-edimart/backups}"
  KEY="${KEY_PREFIX}/edimart-${STAMP}.dump"
  echo "Uploading s3://${S3_BUCKET}/${KEY}"
  aws s3 cp "$FILE" "s3://${S3_BUCKET}/${KEY}" "${ENDPOINT_ARGS[@]}"

  RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
  CUTOFF="$(date -u -d "${RETENTION_DAYS} days ago" +%Y%m%d 2>/dev/null || date -u -v-"${RETENTION_DAYS}"d +%Y%m%d)"
  echo "Pruning remote dumps older than ${RETENTION_DAYS} days (before ${CUTOFF})"
  aws s3 ls "s3://${S3_BUCKET}/${KEY_PREFIX}/" "${ENDPOINT_ARGS[@]}" \
    | awk '{print $4}' \
    | while read -r name; do
        [[ -z "$name" ]] && continue
        # edimart-YYYYMMDDTHHMMSSZ.dump
        day="$(echo "$name" | sed -n 's/^edimart-\([0-9]\{8\}\)T.*/\1/p')"
        if [[ -n "$day" && "$day" < "$CUTOFF" ]]; then
          echo "Deleting s3://${S3_BUCKET}/${KEY_PREFIX}/${name}"
          aws s3 rm "s3://${S3_BUCKET}/${KEY_PREFIX}/${name}" "${ENDPOINT_ARGS[@]}"
        fi
      done
fi

echo "Done."
