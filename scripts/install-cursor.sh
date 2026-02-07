#!/usr/bin/env bash
# Smriti -- Cursor Integration Installer
# Installs hooks configuration for Cursor IDE so that Smriti memory
# is active during Cursor AI sessions.

set -euo pipefail

# ---------- Resolve paths ----------

SMRITI_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKER="${SMRITI_ROOT}/plugin/scripts/worker-service.cjs"
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

# ---------- Pre-flight checks ----------

info "Smriti root: ${SMRITI_ROOT}"

# 1. Check Bun is installed
if ! command -v bun &>/dev/null; then
  fail "Bun is not installed. Install it from https://bun.sh and try again."
fi
ok "Bun found: $(bun --version)"

# 2. Install dependencies if needed
if [ ! -d "${SMRITI_ROOT}/node_modules" ]; then
  info "Installing dependencies..."
  (cd "${SMRITI_ROOT}" && bun install)
  ok "Dependencies installed."
else
  ok "Dependencies already installed."
fi

# 3. Build worker if needed
if [ ! -f "${WORKER}" ]; then
  info "Building worker-service.cjs..."
  (cd "${SMRITI_ROOT}" && bun run build)
  if [ ! -f "${WORKER}" ]; then
    fail "Build completed but worker-service.cjs not found at ${WORKER}"
  fi
  ok "Worker built successfully."
else
  ok "Worker already built: ${WORKER}"
fi

# ---------- Install hooks ----------

# 4. Create hooks directory
if [ ! -d "${HOOKS_DIR}" ]; then
  info "Creating ${HOOKS_DIR}..."
  mkdir -p "${HOOKS_DIR}"
fi

# 5. Back up existing hooks.json
if [ -f "${HOOKS_FILE}" ]; then
  BACKUP="${HOOKS_FILE}.backup.$(date +%Y%m%d%H%M%S)"
  warn "Existing hooks.json found -- backing up to ${BACKUP}"
  cp "${HOOKS_FILE}" "${BACKUP}"
fi

# 6. Generate hooks.json with absolute paths
info "Writing hooks configuration..."
cat > "${HOOKS_FILE}" <<HOOKS_JSON
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "${WORKER} start",
            "timeout": 60
          },
          {
            "type": "command",
            "command": "${WORKER} hook cursor context",
            "timeout": 60
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "${WORKER} hook cursor session-init",
            "timeout": 60
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "${WORKER} hook cursor observation",
            "timeout": 120
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "${WORKER} hook cursor summarize",
            "timeout": 120
          },
          {
            "type": "command",
            "command": "${WORKER} hook cursor session-complete",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
HOOKS_JSON

ok "Hooks installed to ${HOOKS_FILE}"

# ---------- Done ----------

echo ""
info "Installation complete."
echo ""
echo "  Hooks file:  ${HOOKS_FILE}"
echo "  Worker:      ${WORKER}"
echo ""
info "Verification steps:"
echo "  1. Open Cursor IDE"
echo "  2. Start a new AI chat session"
echo "  3. Run a simple prompt and check that Smriti logs appear:"
echo "     tail -f ~/.smriti/smriti.log"
echo ""
info "To uninstall:  bash ${SMRITI_ROOT}/scripts/uninstall-cursor.sh"
echo ""
