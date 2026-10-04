#!/usr/bin/env bash
# Deploy the Moby backend to Nebius (docs/deploy.md).
#
#   ./deploy/nebius/deploy.sh setup      # one-time: registry, data filesystem, secrets, backup bucket
#   ./deploy/nebius/deploy.sh push       # build (linux/amd64) + push the endpoint image
#   ./deploy/nebius/deploy.sh endpoint   # create the always-on Serverless Endpoint (API + poller + DB)
#   ./deploy/nebius/deploy.sh redeploy   # push a new image and recreate the endpoint (data is kept)
#   ./deploy/nebius/deploy.sh embed      # run the embedding Serverless Job once
#   ./deploy/nebius/deploy.sh backup     # run the backup Serverless Job once
#   ./deploy/nebius/deploy.sh status | logs | stop | start
#
# Cost (Nebius list prices, per-second billing): the endpoint is one cpu-d3 2vcpu-8gb VM,
# ~$0.066/h (~$48/month) while running and $0 while stopped. Jobs run on the same VM size
# only while working (CPU preemptible VMs aren't offered) — cents per run. IDs are kept in deploy/nebius/.state (gitignored).
set -euo pipefail

NEBIUS="${NEBIUS:-$HOME/.nebius/bin/nebius}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
STATE="$HERE/.state"
touch "$STATE"
# shellcheck disable=SC1090
source "$STATE"

NAME="${NAME:-moby}"
# Project to deploy into. Projects are regional; CPU VM quota differs per region
# (this tenant has 0 non-GPU vCPUs in us-central1 / eu-north1, 200 in eu-west1).
PARENT_ID="${PARENT_ID:-${SAVED_PARENT_ID:-}}"
P=(); [ -n "$PARENT_ID" ] && P=(--parent-id "$PARENT_ID")
PLATFORM="${PLATFORM:-cpu-d3}"
PRESET="${PRESET:-2vcpu-8gb}"
DATA_GIB="${DATA_GIB:-20}"
TAG="${TAG:-$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M)}"

run() { echo "+ $*" >&2; "$@"; }
save() {  # refuses to record an empty id (e.g. when the create above it failed)
  [ -n "$2" ] || { echo "not saving $1: the command producing it failed (see above)" >&2; exit 1; }
  sed -i '' "/^$1=/d" "$STATE"; echo "$1=$2" >> "$STATE"; export "$1=$2"
}
need() { [ -n "${!1:-}" ] || { echo "missing $1 — run '$0 $2' first" >&2; exit 1; }; }
json_id() { python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except ValueError:
    sys.exit(0)  # create failed and printed its own error; prints nothing so save() refuses
print((d.get("metadata") or d.get("resource") or d).get("id", ""))'; }

cmd_setup() {
  [ -n "$PARENT_ID" ] && save SAVED_PARENT_ID "$PARENT_ID"
  if [ -z "${REGISTRY_ID:-}" ]; then
    save REGISTRY_ID "$(run "$NEBIUS" registry create "${P[@]}" --name "$NAME" --format json | json_id)"
  fi
  if [ -z "${DATA_FS_ID:-}" ]; then
    # Shared filesystem mounted at /data in the endpoint: Postgres lives here and
    # survives endpoint restarts/recreation.
    save DATA_FS_ID "$(run "$NEBIUS" compute filesystem create "${P[@]}" --name "$NAME-data" \
      --type network_ssd --size-gibibytes "$DATA_GIB" --format json | json_id)"
  fi
  if [ -z "${SERVICE_SECRET:-}" ]; then
    # Shared by the endpoint (checks it) and the jobs (send it). Never printed.
    local token; token="$(openssl rand -hex 32)"
    "$NEBIUS" mysterybox secret create "${P[@]}" --name "$NAME-service-token" \
      --secret-version-payload "[{\"key\":\"MOBY_SERVICE_TOKEN\",\"string_value\":\"$token\"}]" >/dev/null
    save SERVICE_SECRET "$NAME-service-token"
    echo "created secret $NAME-service-token" >&2
  fi
  if [ -z "${TF_SECRET:-}" ]; then
    local key; key="$(grep -E '^N_FACTORY_ACC_KEY=' "$ROOT/.env" | cut -d= -f2-)"
    [ -n "$key" ] || { echo "N_FACTORY_ACC_KEY not found in .env" >&2; exit 1; }
    "$NEBIUS" mysterybox secret create "${P[@]}" --name "$NAME-token-factory" \
      --secret-version-payload "[{\"key\":\"N_FACTORY_ACC_KEY\",\"string_value\":\"$key\"}]" >/dev/null
    save TF_SECRET "$NAME-token-factory"
    echo "created secret $NAME-token-factory" >&2
  fi
  if [ -z "${SALT_SECRET:-}" ]; then
    # Salt for reporter_hash. Generated here, stored only in MysteryBox, never printed.
    # Must never change once real reports exist (it would split people into "new" reporters).
    local salt; salt="$(openssl rand -hex 32)"
    "$NEBIUS" mysterybox secret create "${P[@]}" --name "$NAME-reporter-salt" \
      --secret-version-payload "[{\"key\":\"MOBY_REPORTER_SALT\",\"string_value\":\"$salt\"}]" >/dev/null
    save SALT_SECRET "$NAME-reporter-salt"
    echo "created secret $NAME-reporter-salt" >&2
  fi
  if [ -z "${BACKUP_BUCKET:-}" ]; then
    run "$NEBIUS" storage bucket create "${P[@]}" --name "$NAME-backups" >/dev/null
    save BACKUP_BUCKET "$NAME-backups"
  fi
  echo "setup done:"; cat "$STATE"
}

registry_host() {
  # Read the registry's address from Nebius rather than guessing the region.
  "$NEBIUS" registry get "$REGISTRY_ID" --format json | python3 -c '
import json, sys
d = json.load(sys.stdin)
s = json.dumps(d)
import re
m = re.search(r"cr\.[a-z0-9-]+\.nebius\.cloud", s)
print(m.group(0) if m else "")'
}

cmd_push() {
  need REGISTRY_ID setup
  local host; host="$(registry_host)"
  [ -n "$host" ] || { echo "could not read the registry hostname; check 'nebius registry get $REGISTRY_ID'" >&2; exit 1; }
  local image="$host/${REGISTRY_ID#registry-}/$NAME-endpoint:$TAG"
  run "$NEBIUS" registry configure-helper
  # Nebius CPU VMs are x86_64; build for amd64 even on Apple Silicon.
  run docker build --platform linux/amd64 -f "$ROOT/deploy/endpoint/Dockerfile" -t "$image" "$ROOT"
  run docker push "$image"
  save IMAGE "$image"
}

env_from_dotenv() {  # public values only (Firebase web config); secrets come from MysteryBox
  grep -E "^$1=" "$ROOT/.env" 2>/dev/null | tail -1 | cut -d= -f2-
}

cmd_endpoint() {
  need IMAGE push; need DATA_FS_ID setup; need SERVICE_SECRET setup; need SALT_SECRET setup
  local fb_project fb_key fb_domain
  fb_project="$(env_from_dotenv FIREBASE_PROJECT_ID)"; fb_key="$(env_from_dotenv FIREBASE_WEB_API_KEY)"
  fb_domain="$(env_from_dotenv FIREBASE_AUTH_DOMAIN)"
  [ -n "$fb_project" ] || { echo "FIREBASE_PROJECT_ID missing from .env (needed to verify app sign-ins)" >&2; exit 1; }
  # auth=none: the public routes are read-only alert data the app needs without a
  # login; /internal/* checks MOBY_SERVICE_TOKEN itself.
  save ENDPOINT_ID "$(run "$NEBIUS" ai endpoint create "${P[@]}" --name "$NAME-api" \
    --image "$IMAGE" --platform "$PLATFORM" --preset "$PRESET" --on-demand \
    --disk-size 30Gi --container-port 8000 \
    --volume "$DATA_FS_ID:/data" \
    --env-secret "MOBY_SERVICE_TOKEN=$SERVICE_SECRET" \
    --env-secret "MOBY_REPORTER_SALT=$SALT_SECRET" \
    --env "FIREBASE_PROJECT_ID=$fb_project" \
    --env "FIREBASE_WEB_API_KEY=$fb_key" \
    --env "FIREBASE_AUTH_DOMAIN=$fb_domain" \
    --env "NWS_USER_AGENT=moby-early-warning/0.1 (github.com/Xlient/Moby)" \
    --format json | json_id)"
  cmd_status
}

endpoint_url() {
  "$NEBIUS" ai endpoint get "$ENDPOINT_ID" --format json | python3 -c '
import json, re, sys
s = json.dumps(json.load(sys.stdin))
m = re.search(r"https://[^\"]+", s)
print(m.group(0).rstrip("/") if m else "")'
}

job() {  # job <name> <command> [extra flags...]
  need ENDPOINT_ID endpoint; need IMAGE push
  local name="$1" command="$2"; shift 2
  local url; url="$(endpoint_url)"
  [ -n "$url" ] || { echo "endpoint has no URL yet; check '$0 status'" >&2; exit 1; }
  run "$NEBIUS" ai job create "${P[@]}" --name "$NAME-$name-$(date +%Y%m%d-%H%M%S)" \
    --image "$IMAGE" --platform "$PLATFORM" --preset "$PRESET" --on-demand \
    --disk-size 20Gi --timeout 1h --restart-policy never \
    --container-command "$command" \
    --env "MOBY_API_URL=$url" --env-secret "MOBY_SERVICE_TOKEN=$SERVICE_SECRET" "$@"
}

cmd_embed()  { job embed "python -m moby.jobs.embed_events" --env-secret "N_FACTORY_ACC_KEY=$TF_SECRET"; }
cmd_backup() {
  need BACKUP_BUCKET setup
  # The bucket is mounted into the job, so the dump lands in object storage directly.
  # Needs S3 credentials: BACKUP_S3_AUTH=<profile>@<mysterybox-secret> (saved in .state; docs/deploy.md).
  # The secret must hold S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY; the local AWS profile supplies region + endpoint.
  job backup "python -m moby.jobs.backup" --env "BACKUP_DIR=/backup" \
    --volume "s3://$BACKUP_BUCKET:/backup:rw${BACKUP_S3_AUTH:+:$BACKUP_S3_AUTH}"
}

cmd_redeploy() {
  # Endpoints keep the image/env they were created with, so a new version means a new
  # endpoint. The database lives on the shared filesystem, so nothing is lost; the
  # public URL changes (printed at the end).
  need ENDPOINT_ID endpoint
  TAG="${TAG:-$(git -C "$ROOT" rev-parse --short HEAD)-$(date +%H%M)}" cmd_push
  run "$NEBIUS" ai endpoint delete "$ENDPOINT_ID"
  sed -i '' '/^ENDPOINT_ID=/d' "$STATE"; unset ENDPOINT_ID
  cmd_endpoint
}

cmd_status() { need ENDPOINT_ID endpoint; run "$NEBIUS" ai endpoint get "$ENDPOINT_ID"; echo "url: $(endpoint_url)"; }
cmd_logs()   { need ENDPOINT_ID endpoint; run "$NEBIUS" ai endpoint logs "$ENDPOINT_ID" --follow; }
cmd_stop()   { need ENDPOINT_ID endpoint; run "$NEBIUS" ai endpoint stop "$ENDPOINT_ID"; }   # $0 while stopped
cmd_start()  { need ENDPOINT_ID endpoint; run "$NEBIUS" ai endpoint start "$ENDPOINT_ID"; }

case "${1:-}" in
  setup|push|endpoint|redeploy|embed|backup|status|logs|stop|start) "cmd_$1" ;;
  *) sed -n '2,15p' "$0"; exit 1 ;;
esac
