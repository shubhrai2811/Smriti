#!/usr/bin/env bash
# Smriti -- Cursor Integration Uninstaller
# Removes Smriti hooks from Cursor IDE.

set -euo pipefail

CURSOR_DIR="${HOME}/.cursor"
HOOKS_DIR="${CURSOR_DIR}/hooks"
HOOKS_FILE="${HOOKS_DIR}/hooks.json"

# ---------- Colors (when stdout is a terminal) ----------

if [ -t 1 ]; then
  BOLD="\033[1m"
  GREEN="\033[32m"
  YELLOW="\033[33m"
  RED="\033[31m"
  RESET="\033[0m"
else
  BOLD="" GREEN="" YELLOW="" RED="" RESET=""
fi

info()  { echo -e "${BOLD}[smriti]${RESET} $*"; }
ok()    { echo -e "${GREEN}[smriti]${RESET} $*"; }
warn()  { echo -e "${YELLOW}[smriti]${RESET} $*"; }
fail()  { echo -e "${RED}[smriti]${RESET} $*" >&2; exit 1; }

# ---------- Remove hooks ----------

if [ ! -f "${HOOKS_FILE}" ]; then
  info "No hooks.json found at ${HOOKS_FILE} -- nothing to remove."
  exit 0
fi

# Check if this is actually a Smriti hooks file
if grep -q "worker-service.cjs" "${HOOKS_FILE}" 2>/dev/null; then
  info "Removing Smriti hooks from ${HOOKS_FILE}..."
  rm "${HOOKS_FILE}"
  ok "Hooks file removed."
else
  warn "hooks.json does not appear to be a Smriti config. Skipping removal."
  warn "If you want to remove it anyway, delete it manually: rm ${HOOKS_FILE}"
  exit 1
fi

# ---------- Restore backup if available ----------

# Find the most recent backup (nullglob prevents error when no matches)
LATEST_BACKUP=""
shopt -s nullglob
for f in "${HOOKS_FILE}".backup.*; do
  [ -f "$f" ] && LATEST_BACKUP="$f"
done
shopt -u nullglob

if [ -n "${LATEST_BACKUP}" ]; then
  info "Restoring backup: ${LATEST_BACKUP}"
  cp "${LATEST_BACKUP}" "${HOOKS_FILE}"
  ok "Previous hooks.json restored."
fi

# ---------- Optionally stop the worker ----------

SMRITI_ROOT="$(cd "$(dirname "$0")/.." 2>/dev/null && pwd)" || true
WORKER="${SMRITI_ROOT}/plugin/scripts/worker-service.cjs"

if [ -f "${WORKER}" ]; then
  info "Stopping Smriti worker (if running)..."
  "${WORKER}" stop 2>/dev/null || true
  ok "Worker stop signal sent."
fi

# ---------- Done ----------

echo ""
ok "Smriti has been uninstalled from Cursor."
echo "  Your Smriti data remains in ~/.smriti/ (delete manually if desired)."
echo ""
