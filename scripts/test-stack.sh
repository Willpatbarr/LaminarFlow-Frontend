#!/usr/bin/env bash
# The disposable real-backend stack for `npm run test:sync` (LAM-72).
#
#   scripts/test-stack.sh            up, wait until healthy, run a command, always tear down
#   scripts/test-stack.sh -- <cmd>   the same, running <cmd> instead of `npm run test:sync`
#   scripts/test-stack.sh up         build and start it, leave it running, print SYNC_BASE_URL
#   scripts/test-stack.sh down       tear it down (also what the trap runs)
#   scripts/test-stack.sh ref        print the backend ref in use
#
# Variables (all optional):
#   BACKEND_DIR     backend checkout. Default ../LaminarFlow-Backend if it exists,
#                   otherwise BACKEND_REPO is cloned at the ref into .backend-checkout
#   BACKEND_REF     backend branch/tag. Default: the one line in .backend-ref
#   STACK_PORT      host port the app is published on (loopback only). Default 18180
#   STACK_PROJECT   compose project name; containers and network are named from it.
#                   Default lf-sync-test
#   KEEP_STACK=1    leave the stack up after the command (debugging only)
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$PWD

PROJECT=${STACK_PROJECT:-lf-sync-test}
PORT=${STACK_PORT:-18180}
IMAGE=${STACK_IMAGE:-$PROJECT-app:local}
BACKEND_REPO=${BACKEND_REPO:-https://github.com/Willpatbarr/LaminarFlow-Backend.git}
COMPOSE=(docker compose -p "$PROJECT" -f "$ROOT/test-stack/compose.yml")
STAGE=""

log() { echo "==> $*" >&2; }
die() { echo "test-stack: $*" >&2; exit 1; }

backend_ref() {
    if [ -n "${BACKEND_REF:-}" ]; then
        printf '%s' "$BACKEND_REF"
    else
        # First line only, whitespace trimmed: the file is one ref and nothing else.
        head -n 1 "$ROOT/.backend-ref" | tr -d '[:space:]'
    fi
}

compose() {
    STACK_IMAGE=$IMAGE STACK_PORT=$PORT "${COMPOSE[@]}" "$@"
}

teardown() {
    # --volumes and --remove-orphans: nothing of this project may survive.
    compose down --volumes --remove-orphans --timeout 5 >&2 || true
    if [ -n "$STAGE" ]; then rm -rf "$STAGE"; fi
}

resolve_backend() {
    local ref dir
    ref=$(backend_ref)
    [ -n "$ref" ] || die ".backend-ref is empty; it must name a backend branch or tag"
    dir=${BACKEND_DIR:-}
    if [ -z "$dir" ] && [ -d "$ROOT/../LaminarFlow-Backend" ]; then
        dir=$ROOT/../LaminarFlow-Backend
    fi
    if [ -z "$dir" ]; then
        dir=$ROOT/.backend-checkout
        log "no sibling backend checkout; cloning $BACKEND_REPO at $ref into $dir"
        rm -rf "$dir"
        git clone --quiet --depth 1 --branch "$ref" "$BACKEND_REPO" "$dir"
    elif [ -d "$dir/.git" ]; then
        local have
        have=$(git -C "$dir" rev-parse --abbrev-ref HEAD 2>/dev/null || true)
        if [ "$have" != "$ref" ]; then
            log "warning: $dir is on '$have' but the backend ref is '$ref'. A local checkout is used as it stands."
        fi
    fi
    [ -f "$dir/Dockerfile" ] || die "$dir has no Dockerfile; set BACKEND_DIR to a LaminarFlow-Backend checkout"
    BACKEND=$(cd "$dir" && pwd)
}

build_image() {
    resolve_backend
    # The frontend travels as a named build context. A clean copy rather than
    # this directory: node_modules is hundreds of megabytes of host-specific
    # files the image removes and reinstalls anyway, and the named context has
    # no .dockerignore to keep them out of the upload.
    STAGE=$(mktemp -d "${TMPDIR:-/tmp}/lf-frontend-src.XXXXXX")
    rsync -a \
        --exclude .git --exclude node_modules --exclude dist --exclude test-results \
        --exclude playwright-report --exclude .backend-checkout \
        "$ROOT/" "$STAGE/"

    # Versions come from the files that own them, as the backend's own
    # scripts/build-image.sh does.
    local node_version go_version
    node_version=$(tr -d ' \t\nv' < "$ROOT/.nvmrc")
    go_version=$(awk '/^go /{split($2,v,"."); print v[1]"."v[2]; exit}' "$BACKEND/go.mod")

    log "building $IMAGE (backend $BACKEND @ $(git -C "$BACKEND" rev-parse --short HEAD 2>/dev/null || echo '?'), node $node_version, go $go_version)"
    docker build --quiet \
        --build-context "frontendsrc=$STAGE" \
        --build-arg "NODE_VERSION=$node_version" \
        --build-arg "GO_VERSION=$go_version" \
        --tag "$IMAGE" \
        "$BACKEND" >/dev/null
    rm -rf "$STAGE"
    STAGE=""
}

up() {
    command -v docker >/dev/null || die "docker is not installed"
    docker info >/dev/null 2>&1 || die "the docker daemon is not running"
    command -v rsync >/dev/null || die "rsync is required"
    if curl -sf -o /dev/null "http://127.0.0.1:$PORT/healthz" 2>/dev/null; then
        die "something already answers on port $PORT; set STACK_PORT to a free one"
    fi

    # Anything a crashed earlier run left under this project name goes first.
    compose down --volumes --remove-orphans --timeout 5 >/dev/null 2>&1 || true

    build_image
    log "starting $PROJECT on 127.0.0.1:$PORT"
    compose up --detach --quiet-pull >&2

    local waited=0
    until curl -sf -o /dev/null "http://127.0.0.1:$PORT/healthz/db"; do
        if [ "$waited" -ge 120 ]; then
            echo "test-stack: the backend did not become healthy in 120s. Its log:" >&2
            compose logs --no-color app db >&2 || true
            return 1
        fi
        sleep 1
        waited=$((waited + 1))
    done
    log "healthy after ${waited}s"
}

mode=${1:-run}
case "$mode" in
    ref)
        backend_ref; echo
        ;;
    down)
        teardown
        ;;
    up)
        trap 'teardown' ERR
        up
        trap - ERR
        echo "export SYNC_BASE_URL=http://127.0.0.1:$PORT"
        ;;
    run|--)
        [ "$mode" = "--" ] && shift
        [ "$mode" = "run" ] && [ "$#" -gt 0 ] && shift
        cmd=("$@")
        if [ "${#cmd[@]}" -eq 0 ]; then cmd=(npm run test:sync); fi
        trap '[ -n "${KEEP_STACK:-}" ] && log "KEEP_STACK set: leaving $PROJECT up" || teardown' EXIT
        trap 'exit 130' INT
        trap 'exit 143' TERM
        up
        status=0
        SYNC_BASE_URL="http://127.0.0.1:$PORT" "${cmd[@]}" || status=$?
        exit "$status"
        ;;
    *)
        die "unknown mode '$mode' (up | down | ref | -- <cmd>)"
        ;;
esac
