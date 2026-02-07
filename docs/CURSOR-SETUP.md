# Smriti -- Cursor IDE Setup

This guide covers installing and configuring Smriti for Cursor IDE.
Once installed, Smriti will automatically observe your AI coding sessions in
Cursor and provide relevant memory context, just as it does in Claude Code.

**Cross-IDE memory**: Smriti uses a shared SQLite database. Observations
captured in Claude Code sessions are available in Cursor, and vice versa.
You get a unified memory across all supported IDEs.

---

## Prerequisites

- **Bun** (>= 1.0) -- install from [bun.sh](https://bun.sh)
- **Cursor IDE** -- with AI features enabled

## Quick Install

From the Smriti project root:

```bash
bash scripts/install-cursor.sh
```

The script will:

1. Verify Bun is installed
2. Run `bun install` if dependencies are missing
3. Run `bun run build` if the worker hasn't been built yet
4. Back up any existing `~/.cursor/hooks/hooks.json`
5. Write a new `hooks.json` with absolute paths to the Smriti worker

## Manual Install

If you prefer to set things up by hand:

### 1. Build the worker

```bash
cd /path/to/smriti
bun install
bun run build
```

This produces `plugin/scripts/worker-service.cjs`.

### 2. Create the hooks directory

```bash
mkdir -p ~/.cursor/hooks
```

### 3. Write the hooks config

Create `~/.cursor/hooks/hooks.json` with the following content.
Replace `/path/to/smriti` with the **absolute path** to your Smriti checkout.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/smriti/plugin/scripts/worker-service.cjs start",
            "timeout": 60
          },
          {
            "type": "command",
            "command": "/path/to/smriti/plugin/scripts/worker-service.cjs hook cursor context",
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
            "command": "/path/to/smriti/plugin/scripts/worker-service.cjs hook cursor session-init",
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
            "command": "/path/to/smriti/plugin/scripts/worker-service.cjs hook cursor observation",
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
            "command": "/path/to/smriti/plugin/scripts/worker-service.cjs hook cursor summarize",
            "timeout": 120
          },
          {
            "type": "command",
            "command": "/path/to/smriti/plugin/scripts/worker-service.cjs hook cursor session-complete",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

## Verification

After installing, confirm Smriti is working:

1. **Open Cursor** and start a new AI chat session.
2. **Send a prompt** -- Smriti should activate on session start.
3. **Check the log file**:
   ```bash
   tail -f ~/.smriti/smriti.log
   ```
   You should see lines like:
   ```
   [worker] start: worker started
   [hook] cursor context: injecting memory context
   [hook] cursor session-init: session initialized
   ```
4. **Use a tool** (e.g., ask Cursor to edit a file). After the tool runs,
   Smriti captures an observation via the PostToolUse hook.
5. **End the session**. The Stop hook triggers summarization and session
   completion.

## Troubleshooting

### "Bun is not installed"

Install Bun:
```bash
curl -fsSL https://bun.sh/install | bash
```
Then re-run the install script.

### Hooks not firing

- Confirm the hooks file exists: `ls -la ~/.cursor/hooks/hooks.json`
- Verify the paths in the JSON point to the actual `worker-service.cjs` file:
  ```bash
  head -1 ~/.cursor/hooks/hooks.json
  ```
- Ensure the worker is executable: `ls -la /path/to/smriti/plugin/scripts/worker-service.cjs`
- Restart Cursor after installing hooks.

### Worker fails to start

- Check Bun is on your PATH: `which bun`
- Try running the worker manually:
  ```bash
  /path/to/smriti/plugin/scripts/worker-service.cjs start
  ```
- Check logs for errors: `cat ~/.smriti/smriti.log`

### Permission denied

Make sure the worker is executable:
```bash
chmod +x /path/to/smriti/plugin/scripts/worker-service.cjs
```

### Hooks from a previous tool were overwritten

The install script creates a timestamped backup before writing. Look for:
```bash
ls ~/.cursor/hooks/hooks.json.backup.*
```
You can restore one manually:
```bash
cp ~/.cursor/hooks/hooks.json.backup.20250101120000 ~/.cursor/hooks/hooks.json
```

## Uninstall

Run the uninstall script:

```bash
bash scripts/uninstall-cursor.sh
```

This will:

1. Remove `~/.cursor/hooks/hooks.json` (only if it contains Smriti references)
2. Restore the most recent backup if one exists
3. Send a stop signal to the Smriti worker

Your Smriti data (observations, sessions, embeddings) remains in `~/.smriti/`.
Delete that directory manually if you want a clean removal:

```bash
rm -rf ~/.smriti
```

## How It Works

Cursor's hook system fires events at key moments during AI sessions:

| Hook              | When it fires              | What Smriti does                        |
|-------------------|----------------------------|-----------------------------------------|
| SessionStart      | New AI chat begins         | Starts worker, injects memory context   |
| UserPromptSubmit  | User sends a message       | Initializes session tracking            |
| PostToolUse       | After each tool execution  | Captures observation (file edit, shell)  |
| Stop              | Session ends               | Summarizes session, marks complete       |

All observations flow into the same shared SQLite database used by Claude Code,
giving you a unified memory across both IDEs.
