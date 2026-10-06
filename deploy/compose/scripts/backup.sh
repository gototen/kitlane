#!/usr/bin/env sh
# Full operator backup: database dump + deployed files volume. Output is PRIVATE operational data
# (it contains personal documents, credential hashes, and identity mapping). Protect it accordingly.
set -eu
cd "$(dirname "$0")/.."
OUT="${1:-./backups/kitlane-$(date -u +%Y%m%dT%H%M%SZ)}"
mkdir -p "$OUT"
echo "dumping database..."
docker compose exec -T postgres pg_dump -U kitlane -d kitlane --no-owner --format=custom > "$OUT/kitlane.pgdump"
echo "archiving deployed files and server secret..."
docker run --rm -v "$(docker compose config --format json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=JSON.parse(s);process.stdout.write(c.volumes["kitlane-data"].name)})')":/data:ro -v "$(cd "$OUT" && pwd)":/out alpine sh -c 'cd /data && tar czf /out/kitlane-data.tar.gz .'
cp .env "$OUT/env.backup"
chmod 600 "$OUT"/*
echo "backup written to $OUT"
echo "  kitlane.pgdump        database (catalog, documents, grants, audit, identity mapping)"
echo "  kitlane-data.tar.gz   deployed files + server secret"
echo "  env.backup            configuration and secrets"
echo "Keep this private. Restore with scripts/restore.sh <dir>."
