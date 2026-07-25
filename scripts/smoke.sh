#!/usr/bin/env bash
# Lumina smoke test — hit the real API of a running instance and report
# pass/fail per check. Usage:
#   ./scripts/smoke.sh [base-url]        e.g. ./scripts/smoke.sh http://10.41.6.52:3422
#   ./scripts/smoke.sh --hls [base-url]  also start a real HLS transcode session
set -u

HLS=0
if [ "${1:-}" = "--hls" ]; then HLS=1; shift; fi
BASE="${1:-http://localhost:8096}"
FAILS=0

check() { # check <name> <ok:0|1> [detail]
  if [ "$2" = "0" ]; then
    printf '  ok   %s%s\n' "$1" "${3:+ — $3}"
  else
    printf '  FAIL %s%s\n' "$1" "${3:+ — $3}"
    FAILS=$((FAILS + 1))
  fi
}

get() { curl -s -m 15 -o /tmp/lumina-smoke-body -w '%{http_code}' "$BASE$1"; }

echo "Lumina smoke test → $BASE"

# 1. health
code=$(get /healthz)
body=$(cat /tmp/lumina-smoke-body)
[ "$code" = "200" ] && echo "$body" | grep -q '"status":"ok"'
check "GET /healthz" "$?" "$body"

# 2. capabilities
code=$(get /api/v1/system/capabilities)
body=$(cat /tmp/lumina-smoke-body)
[ "$code" = "200" ] && echo "$body" | grep -q '"vaapi"'
check "GET /api/v1/system/capabilities" "$?" "$(echo "$body" | grep -o '"encoders":{[^}]*}')"

# 3. libraries
code=$(get /api/v1/libraries)
body=$(cat /tmp/lumina-smoke-body)
[ "$code" = "200" ] && echo "$body" | grep -q '\['
check "GET /api/v1/libraries" "$?"
echo "$body" | grep -o '"name":"[^"]*"[^}]*' | while read -r lib; do
  n=$(echo "$lib" | grep -o '^"name":"[^"]*"' | cut -d'"' -f4)
  items=$(echo "$lib" | grep -o '"items":[0-9]*' | cut -d: -f2)
  watcher=$(echo "$lib" | grep -o '"watcher":"[^"]*"' | cut -d'"' -f4)
  exists=$(echo "$lib" | grep -o '"exists":[a-z]*' | cut -d: -f2)
  printf '       library %-20s items=%-5s watcher=%-8s exists=%s\n' "$n" "${items:-?}" "${watcher:-?}" "${exists:-n/a}"
done

# 4. items
code=$(get /api/v1/items)
body=$(cat /tmp/lumina-smoke-body)
total=$(echo "$body" | grep -o '"id":"itm-' | wc -l | tr -d ' ')
identified=$(echo "$body" | grep -o '"tmdbId":[1-9]' | wc -l | tr -d ' ')
[ "$code" = "200" ] && [ "$total" -gt 0 ]
check "GET /api/v1/items" "$?" "$total items, $identified identified"
first_id=$(echo "$body" | grep -o '"id":"itm-[0-9]*"' | head -1 | cut -d'"' -f4)

# 5. users
code=$(get /api/v1/users)
[ "$code" = "200" ] && grep -q '"id":"usr-' /tmp/lumina-smoke-body
check "GET /api/v1/users" "$?"

# 6. ffprobe info on one item
if [ -n "$first_id" ]; then
  code=$(get "/api/v1/items/$first_id/info")
  body=$(cat /tmp/lumina-smoke-body)
  [ "$code" = "200" ] && echo "$body" | grep -q '"container"'
  check "GET /api/v1/items/$first_id/info" "$?" "$(echo "$body" | grep -o '"container":"[^"]*"')"
fi

# 7. metadata search (newer builds only — 404 on old ones is reported, not fatal)
code=$(get "/api/v1/metadata/search?kind=movies&q=alien")
if [ "$code" = "404" ]; then
  printf '  skip GET /api/v1/metadata/search — not in this build yet\n'
else
  [ "$code" = "200" ]
  check "GET /api/v1/metadata/search" "$?" "$(grep -o '"title":"[^"]*"' /tmp/lumina-smoke-body | head -3 | tr '\n' ' ')"
fi

# 8. optional: real HLS session
if [ "$HLS" = "1" ] && [ -n "$first_id" ]; then
  code=$(get "/api/v1/items/$first_id/hls/index.m3u8")
  body=$(cat /tmp/lumina-smoke-body)
  [ "$code" = "200" ] && echo "$body" | grep -q '#EXTM3U'
  check "GET /api/v1/items/$first_id/hls/index.m3u8" "$?" "$(echo "$body" | head -1)"
  code=$(get /api/v1/system/sessions)
  grep -q "$first_id" /tmp/lumina-smoke-body
  check "GET /api/v1/system/sessions shows the session" "$?" "$(cat /tmp/lumina-smoke-body)"
fi

rm -f /tmp/lumina-smoke-body
echo
if [ "$FAILS" -eq 0 ]; then
  echo "ALL CHECKS PASSED"
else
  echo "$FAILS CHECK(S) FAILED"
  exit 1
fi
