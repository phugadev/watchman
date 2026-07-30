#!/usr/bin/env sh
#
# Take a consistent backup of a running Watchman container.
#
#   ./scripts/backup.sh [container] [output-dir]
#
# Defaults to the container named "watchman" and ./backups.
#
# Uses SQLite's VACUUM INTO, which produces a single self-contained file that is a
# transactionally consistent snapshot even while the scheduler is mid-write. Copying
# /data/watchman.db instead would give you a *stale* database rather than a broken one —
# and it would pass PRAGMA integrity_check, which is what makes that mistake so easy to
# make and so hard to notice. See the Backups section of the README.
#
# The image has no sqlite3 CLI, so this drives better-sqlite3 through node, which is
# already there.

set -eu

CONTAINER="${1:-watchman}"
OUTDIR="${2:-./backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$OUTDIR/watchman-$STAMP.db"

# A path inside the container that is writable and ephemeral, so a failed run cannot
# leave a half-written file sitting on the data volume consuming space.
TMP="/tmp/watchman-backup-$STAMP.db"

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "backup: no container named '$CONTAINER'" >&2
  exit 1
fi

mkdir -p "$OUTDIR"

# VACUUM INTO refuses to overwrite, so the timestamped name is doing real work here.
docker exec "$CONTAINER" node -e "
  const db = require('better-sqlite3')(process.env.WATCHMAN_DB_PATH || '/data/watchman.db');
  db.exec(\"VACUUM INTO '$TMP'\");
  db.close();
"

docker cp "$CONTAINER:$TMP" "$OUT"
docker exec "$CONTAINER" rm -f "$TMP"

# Verify what landed on disk, not what we hoped landed. A backup nobody has read back is
# a guess.
docker exec -i "$CONTAINER" node -e "
  const fs = require('node:fs');
  fs.writeFileSync('$TMP', fs.readFileSync(0));
  const db = require('better-sqlite3')('$TMP', { readonly: true });
  const integrity = db.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') { console.error('backup: integrity_check said ' + integrity); process.exit(1); }
  const checks = db.prepare('select count(*) c from checks').get().c;
  const incidents = db.prepare('select count(*) c from incidents').get().c;
  const monitors = db.prepare('select count(*) c from monitors').get().c;
  console.log('  integrity ok · ' + monitors + ' monitors, ' + incidents + ' incidents, ' + checks + ' checks');
" < "$OUT"
docker exec "$CONTAINER" rm -f "$TMP" 2>/dev/null || true

echo "backup: $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes)"
