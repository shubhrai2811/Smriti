# Cortex - Requirements Specification

> Intelligent memory system for AI coding assistants. Open-source Claude Code plugin that captures, learns from, and intelligently resurfaces developer context across sessions and IDEs.

---

## 1. Project Identity

| Field | Value |
|-------|-------|
| **Name** | Cortex |
| **Tagline** | "Your AI assistant's long-term memory" |
| **Type** | Claude Code Plugin (open-source) |
| **Goal** | Replace claude-mem as the go-to memory plugin with smarter context, developer learning, and cross-IDE support |
| **Runtime** | Bun (TypeScript, ESM) |
| **License** | TBD (before first public release) |

### What Makes Cortex Different from claude-mem

| Problem in claude-mem | Cortex Solution |
|---|---|
| Dumb context injection (last N by recency) | Relevance-scored retrieval (embedding similarity + recency + importance) |
| No learning over time | Reflection system builds developer profile, detects patterns |
| Chroma requires Python (breaks on Windows) | sqlite-vec for embedded vector search, zero Python |
| Only works with Claude Code | Cross-IDE: Claude Code + Cursor, shared database |
| One AI call per tool use (expensive) | Observation batching (5-10 per call, ~60% cost reduction) |
| Silent failures (observations lost, user unaware) | Transparent: inline summary + web dashboard |
| Stateful worker (session state lost on restart) | Stateless worker, all state in SQLite |
| Only Claude SDK (others broken) | Claude SDK primary + OpenRouter fallback |
| 121+ orphan processes (44GB memory leak) | Process registry with proper lifecycle cleanup |
| No database cleanup (grows forever) | Archival strategy with retention policies |

---

## 2. Functional Requirements

### FR-1: Hook Lifecycle

The plugin must integrate with Claude Code's hook system to capture session data.

| Hook Event | Behavior |
|---|---|
| **SessionStart** | Start/resume worker, inject context from previous sessions |
| **UserPromptSubmit** | Create/resume session in DB, store user prompt |
| **PostToolUse** | Buffer tool output for observation extraction |
| **Stop** | Flush observation buffer, generate session summary, run quick reflection, mark session complete |

**Acceptance Criteria:**
- All 4 hooks execute within their timeout limits (SessionStart: 60s, PostToolUse: 120s, Stop: 120s)
- Hook failures are non-blocking (exit code 1) — Claude Code continues
- Hooks communicate with worker via HTTP (localhost only)
- stdin JSON parsing handles all Claude Code hook input formats

### FR-2: Worker Service

A persistent background service that manages all data operations.

**Requirements:**
- HTTP server on localhost (dynamic port, stored in config)
- Auto-start on first hook call, auto-shutdown after idle timeout
- Health and readiness endpoints
- Stateless: all session state lives in SQLite, worker can restart without data loss
- PID file management for process lifecycle
- Graceful shutdown with ordered cleanup

**API Endpoints (minimum):**
```
GET  /health              — Liveness
GET  /readiness            — DB initialized check
POST /sessions/init        — Create/resume session
POST /sessions/:id/observe — Buffer observation
POST /sessions/:id/flush   — Force-process buffered observations
POST /sessions/:id/summarize — Generate session summary
POST /sessions/:id/complete — Mark session done
GET  /context/inject       — Get context for current prompt
GET  /search               — Semantic + keyword search
GET  /data/sessions        — List sessions (paginated)
GET  /data/observations    — List observations (paginated)
GET  /data/reflections     — List reflections
GET  /settings             — Read settings
PUT  /settings             — Update settings
```

### FR-3: Observation Extraction

Transform raw tool outputs into structured observations using AI.

**Requirements:**
- Buffer tool outputs within a session (don't call AI per tool use)
- Batch process 5-10 observations in one AI call
- Extract structured data per observation:
  - `type`: bugfix, feature, refactor, discovery, decision, pattern, config, dependency
  - `title`: concise description
  - `facts`: key facts as JSON array
  - `concepts`: related concepts/technologies
  - `files_affected`: file paths involved
  - `importance`: 1-10 score (LLM-assigned at capture time)
- Support two AI providers:
  - **Claude SDK** (primary): Uses Claude Code subscription, no extra API keys
  - **OpenRouter** (fallback): Configurable model, requires API key
- Provider interface with adapter pattern (clean abstraction, not if/else)
- Concise extraction prompts with few-shot examples (not verbose instructions)
- Track token usage per session (input, output, cache)

### FR-4: Smart Context Injection

Inject relevant observations into new sessions, scored by multiple signals — not just recency.

**Requirements:**
- On SessionStart, build context from:
  - Recent observations for this project
  - Relevant observations from other sessions (semantic search)
  - Session summaries
  - Active reflections/insights
  - Developer profile entries (if relevant)
- **Retrieval scoring formula:**
  ```
  score = recency_weight * exponential_decay(age)
        + relevance_weight * embedding_similarity(observation, current_context)
        + importance_weight * importance_score
  ```
- Configurable weights (defaults: recency=0.3, relevance=0.5, importance=0.2)
- Token budget enforcement: fill context to N tokens (configurable, default 4000), not N observations
- Deduplication: merge/skip semantically similar observations
- Format as clean markdown injected via `hookSpecificOutput.additionalContext`
- **Transparency**: show configurable inline summary (default ON):
  ```
  [cortex: 7 observations, 2 reflections | 1,247 tokens | top relevance: 0.94]
  ```

### FR-5: Vector Search (Embedded)

Semantic search without external dependencies.

**Requirements:**
- Use sqlite-vec for vector storage (embedded in SQLite, no Python)
- Use ONNX Runtime with multilingual-e5-small (or similar) for local embeddings
- Embed observations at storage time
- Embed reflections at storage time
- Support hybrid search: vector similarity + keyword FTS5 + metadata filters
- All embeddings computed locally (no API calls for embedding)

### FR-6: Session Summarization

Generate structured summaries when sessions end.

**Requirements:**
- On Stop hook, generate summary containing:
  - `request`: What the user asked for
  - `learned`: Key things discovered
  - `completed`: What was accomplished
  - `next_steps`: Unfinished work or follow-ups
- Store in summaries table
- Include in future context injection
- Use same AI provider as observation extraction

### FR-7: Reflection & Learning System

The plugin gets smarter over time by synthesizing across sessions.

**Requirements:**
- **Quick reflection** (end of each session):
  - After summarization, generate 0-3 quick insights
  - Compare current session to recent sessions
  - Detect: repeated patterns, recurring bugs, style preferences
  - Store as reflection with source_observation_ids
- **Deep reflection** (periodic background):
  - Run every N sessions (configurable, default: 5) or daily
  - Analyze last 20 sessions worth of observations
  - Generate higher-order insights:
    - "You tend to hit import errors when refactoring TypeScript"
    - "You prefer composition over inheritance"
    - "Consider writing tests before refactoring — last 3 refactors broke things"
  - Cross-link related observations
  - Update developer profile
- **Developer profile** (accumulated over time):
  - Categories: preference, pattern, common_mistake, style, strength
  - Confidence score (grows with evidence)
  - Evidence count and last_seen date
  - Inject relevant profile entries into context
- **Reflection types**: pattern, preference, warning, skill, insight

### FR-8: Database

SQLite with structured schema, migrations, and proper indexing.

**Requirements:**
- SQLite via `bun:sqlite` with WAL mode
- Migration system (versioned, idempotent)
- Tables: sessions, observations, observation_links, summaries, reflections, entities, entity_relations, developer_profile, prompts, settings
- Vector tables via sqlite-vec: observation_vectors, reflection_vectors
- Full-text search via FTS5: observations_fts
- Proper indexes on project, branch, epoch, type, importance
- Foreign key constraints enforced
- Archival: configurable retention policy (default: 90 days for raw observations, reflections kept indefinitely)
- Database location: `~/.cortex/cortex.sqlite`

### FR-9: Privacy & Security

**Requirements:**
- All data stays local (no cloud sync, no telemetry, no analytics)
- Privacy tag stripping: `<private>...</private>` content never stored
- API keys stored in `~/.cortex/.env` (isolated from shell environment)
- Worker listens on localhost only (127.0.0.1)
- CORS restricted to localhost origins
- No secrets in observations (detect and redact common patterns: API keys, tokens, passwords)

### FR-10: Multi-IDE Support

**Requirements (Phase 1: Claude Code only, Phase 2: add Cursor):**
- Adapter pattern for IDE normalization (same as claude-mem's approach)
- Shared SQLite database at `~/.cortex/cortex.sqlite`
- Each observation tagged with `source_ide` field (claude-code, cursor)
- Context injection works regardless of which IDE is being used
- IDE-specific hook formats handled by adapters
- Combined context from both IDEs when injecting (most relevant, regardless of source)

### FR-11: Branch Awareness

**Requirements:**
- Tag observations with git branch name
- Tag observations with project path
- Filter context injection by current branch (configurable: branch-only, or branch + main)
- Worktree support: different contexts for different worktrees
- Cross-branch pattern detection in reflections

### FR-12: Configuration

**Requirements:**
- Settings stored in `~/.cortex/settings.json`
- Configurable values (with sensible defaults):
  - `worker.port`: dynamic (default: auto-assign)
  - `worker.idleTimeout`: minutes before auto-shutdown (default: 30)
  - `extraction.provider`: claude-sdk | openrouter (default: claude-sdk)
  - `extraction.openrouter.model`: model ID for OpenRouter
  - `extraction.openrouter.apiKey`: (stored in .env, not settings)
  - `extraction.batchSize`: observations per AI call (default: 5)
  - `context.tokenBudget`: max tokens for context injection (default: 4000)
  - `context.recencyWeight`: 0-1 (default: 0.3)
  - `context.relevanceWeight`: 0-1 (default: 0.5)
  - `context.importanceWeight`: 0-1 (default: 0.2)
  - `context.inlineSummary`: true | false (default: true)
  - `context.verbosity`: minimal | brief | full (default: brief)
  - `reflection.quickEnabled`: true | false (default: true)
  - `reflection.deepEnabled`: true | false (default: true)
  - `reflection.deepInterval`: sessions between deep reflections (default: 5)
  - `archive.retentionDays`: days before archival (default: 90)
  - `privacy.redactSecrets`: auto-detect and redact secrets (default: true)

---

## 3. Non-Functional Requirements

### NFR-1: Performance
- Hook scripts must execute in <2 seconds for responsive UX
- Context injection (SessionStart) must complete in <5 seconds
- Observation buffering must be non-blocking (fire-and-forget from hook)
- Worker startup must complete in <3 seconds
- Database queries for context must complete in <500ms

### NFR-2: Reliability
- Zero data loss: observations persist before processing (claim-confirm pattern)
- Worker crash recovery: restart picks up pending work from DB
- Graceful degradation: if worker is down, hooks exit silently (exit 0)
- No orphan processes: process registry with cleanup
- Atomic transactions for multi-table writes

### NFR-3: Cost Efficiency
- Observation batching: ~60% fewer AI calls than per-tool-use approach
- Concise prompts: <500 tokens per extraction call
- Observation masking for old data: replace verbose tool output with summaries
- Token usage tracking and reporting per session
- Target: <$0.01 per typical coding session (with Claude Haiku-tier extraction)

### NFR-4: Developer Experience
- Zero-config installation (plugin install, works immediately)
- No Python dependency (all native Bun/TypeScript)
- No Docker dependency
- Works on macOS, Linux, Windows
- Clear error messages (not "ProcessTransport not ready")
- Transparent failures (user knows when something breaks)

### NFR-5: Extensibility
- Provider interface for AI extraction (easy to add new models)
- IDE adapter interface (easy to add new IDEs)
- Clean module boundaries (services, handlers, database are independent)

### NFR-6: Security
- Localhost-only worker (never exposed to network)
- No cloud communication (fully local)
- Credential isolation (separate .env)
- Privacy tag enforcement at hook layer (before data reaches worker)

---

## 4. User Stories

### Core Experience
- **US-1**: As a developer, I want my Claude Code sessions to remember what I worked on yesterday, so I don't have to re-explain context.
- **US-2**: As a developer, I want context injected based on relevance to my current task, not just what happened most recently.
- **US-3**: As a developer, I want to mark content as `<private>` so it's never stored in memory.

### Learning & Reflection
- **US-4**: As a developer, I want Cortex to learn my coding patterns over time and proactively warn me about past mistakes.
- **US-5**: As a developer, I want to see insights like "You've fixed this type of bug 3 times — here's what worked."
- **US-6**: As a developer, I want a developer profile that captures my preferences (testing style, error handling patterns, preferred libraries).

### Transparency
- **US-7**: As a developer, I want to see a brief summary of what context was injected into my session.
- **US-8**: As a developer, I want a web dashboard to browse my memory timeline, search observations, and view reflections.
- **US-9**: As a developer, I want to know when an observation fails to save, not have it silently disappear.

### Cross-IDE
- **US-10**: As a developer, I want observations from my Cursor sessions to be available in Claude Code and vice versa.
- **US-11**: As a developer, I want to work on the same project in different IDEs and have a unified memory.

### Branch Awareness
- **US-12**: As a developer, I want observations scoped to my current git branch, so feature work doesn't pollute main branch context.
- **US-13**: As a developer, I want cross-branch insights when the same bug appears in multiple branches.

### Cost & Performance
- **US-14**: As a developer, I want Cortex to batch observations to minimize AI costs.
- **US-15**: As a developer, I want hook execution to be fast enough that I never notice it.

---

## 5. Phased Delivery Plan (Recommended)

### Phase 1: Foundation
**Goal**: Working hook lifecycle with SQLite storage, basic extraction, basic context injection.
- Hook lifecycle (SessionStart, UserPromptSubmit, PostToolUse, Stop)
- Worker service (Hono on localhost, Bun runtime)
- SQLite database with migrations (sessions, observations, summaries, prompts)
- Claude SDK extraction (single provider, batching from day 1)
- Basic context injection (recency-based, token-budgeted)
- Privacy tag stripping
- Plugin manifest, hooks.json, build system (esbuild)
- Inline summary transparency (brief mode)
- Process lifecycle management (no orphans)

### Phase 2: Smart Context
**Goal**: Relevance-scored context injection — the headline differentiator.
- sqlite-vec integration (embedded vector search)
- Local ONNX embeddings (multilingual-e5-small)
- Embed observations at storage time
- Multi-signal retrieval scoring (recency + relevance + importance)
- Token budget enforcement
- Observation deduplication
- FTS5 full-text search
- Hybrid search (vector + keyword + filters)

### Phase 3: Reflection & Learning
**Goal**: Cortex gets smarter over time.
- Quick reflection (end of session)
- Deep reflection (periodic background)
- Developer profile extraction
- Cross-session pattern detection
- Inject reflections and profile into context
- Observation cross-linking (Zettelkasten links)

### Phase 4: Cost & Quality
**Goal**: Reduce AI costs, improve extraction quality.
- Observation batching optimization
- Observation masking for old data
- Concise extraction prompts (few-shot)
- Token cost tracking and reporting
- OpenRouter as fallback provider
- Provider adapter interface

### Phase 5: Multi-IDE & Branch
**Goal**: Cross-IDE memory and branch awareness.
- Cursor IDE adapter
- Source IDE tagging on observations
- Combined cross-IDE context injection
- Git branch tagging
- Branch-scoped context injection
- Worktree support

### Phase 6: Web UI
**Goal**: Beautiful dashboard for browsing and managing memory.
- Web viewer (React, served from worker)
- Timeline view with observation cards
- Search with filters (type, date, project, branch, IDE)
- Reflection insights dashboard
- Token cost metrics
- Settings management
- Export/import functionality

### Phase 7: Polish & Advanced
**Goal**: Production hardening and advanced features.
- Database archival with retention policies
- Entity graph (lightweight knowledge graph)
- Proactive mid-session context push
- Secret detection and redaction
- Database encryption (SQLCipher)
- MCP search tools
- Metrics dashboard
- Cross-project pattern abstraction

---

## 6. Open Questions

1. **Embedding model**: multilingual-e5-small (384 dims, ~100MB) vs. all-MiniLM-L6-v2 (384 dims, ~80MB) vs. nomic-embed-text-v1.5? Need to benchmark quality vs. size vs. speed on Bun.
2. **sqlite-vec vs. LanceDB**: sqlite-vec is embedded in SQLite (simpler) but LanceDB has better ANN performance at scale. How many observations do we expect per user?
3. **Cursor hook format**: Need to research Cursor's plugin/extension hook system to verify the adapter approach will work.
4. **OpenRouter model selection**: Which model for extraction? Haiku-class for cost, or Sonnet-class for quality? Should this be user-configurable?
5. **Web UI framework**: React (same as claude-mem, proven) vs. Svelte (smaller bundle, faster) vs. vanilla HTML?
6. **Plugin marketplace**: Does Claude Code have a plugin marketplace yet? If not, distribution is via git clone + manual install.
7. **Bun compatibility**: sqlite-vec and ONNX Runtime Bun compatibility need verification.

---

## 7. Tech Stack (Finalized)

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Runtime | Bun | Fast startup, native SQLite, TypeScript native |
| Language | TypeScript (ESM) | Type safety, modern module system |
| Database | SQLite (bun:sqlite) | Zero dependency, fast, WAL mode |
| Vector Search | sqlite-vec | Embedded, no Python, no external process |
| Embeddings | ONNX Runtime (local model) | Free, local, no API calls |
| HTTP Server | Hono | Lightweight (~14KB), excellent Bun support, modern API |
| Build | esbuild | Fast bundling to CJS for hook scripts |
| AI Extraction (primary) | Claude Agent SDK | Uses existing subscription |
| AI Extraction (fallback) | OpenRouter | Configurable model, API key |
| UI | React (bundled into single HTML) | Proven pattern from claude-mem |
| Testing | Bun test | Native, fast |

---

## 8. Directory Structure (Proposed)

```
cortex/
  src/
    cli/
      handlers/           # Hook event handlers
      adapters/           # IDE adapters (claude-code, cursor)
      hook-command.ts     # Hook router
      stdin-reader.ts     # JSON stdin parser
    services/
      worker.ts           # Main worker orchestrator
      server.ts           # Hono HTTP server
      routes/             # Route handlers
      providers/
        provider.ts       # Provider interface
        claude-sdk.ts     # Claude SDK adapter
        openrouter.ts     # OpenRouter adapter
      extraction/
        prompts.ts        # AI extraction prompts
        batcher.ts        # Observation batching
        parser.ts         # Response parser
      context/
        builder.ts        # Context assembly
        scorer.ts         # Relevance scoring
        embedder.ts       # ONNX embedding
      reflection/
        quick.ts          # End-of-session reflection
        deep.ts           # Periodic deep reflection
        profile.ts        # Developer profile
      sqlite/
        database.ts       # Connection + migrations
        sessions.ts       # Session CRUD
        observations.ts   # Observation CRUD
        summaries.ts      # Summary CRUD
        reflections.ts    # Reflection CRUD
        vectors.ts        # sqlite-vec operations
        migrations/       # Schema versions
    shared/
      config.ts           # Settings manager
      paths.ts            # File path constants
      types.ts            # Shared TypeScript types
    utils/
      privacy.ts          # Tag stripping, secret detection
      process.ts          # Process lifecycle management
      logger.ts           # Structured logging
  plugin/
    .claude-plugin/
      plugin.json         # Plugin manifest
    hooks/
      hooks.json          # Hook definitions
    scripts/              # Built hook scripts (esbuild output)
  ui/
    src/                  # React web viewer
  scripts/
    build.ts              # esbuild bundler
  tests/                  # Test suite
  package.json
  tsconfig.json
```
