# Local Context Store

> Your context. Any coding agent.

A local-first context store for coding agents such as **Claude Code, Codex, Cursor, Gemini CLI, and other MCP-compatible agents**.

The MVP has one job: **keep useful project context outside any single agent session, then retrieve only what the next task needs.**

## Why

Coding-agent conversations are ephemeral and agent-specific. Decisions, constraints, failed approaches, and active work get lost when a session ends or when you switch from Claude Code to Codex.

Local Context Store keeps durable context in one project-local SQLite database:

```text
Claude Code ─┐
Codex ───────┼── MCP ── Local Context Store ── .context/context.db
Cursor ──────┤
Gemini ──────┘
```

The database belongs to the **project**, not to the agent.

## MVP

- Local SQLite + WAL
- FTS5 keyword retrieval
- Project-scoped context items
- Importance + recency ranking
- Token-budgeted task context packs
- Snapshots for resume / handoff
- MCP server over stdio
- Small `ctx` CLI
- GitHub Actions CI on Node 20/22/24

Not in v0.1: embeddings, vector databases, graph memory, cloud sync, automatic conversation parsing, or agent-specific hooks.

## Requirements

- Node.js 20+
- npm

## Install from source

```bash
git clone https://github.com/haomiao33/local-context-store.git
cd local-context-store
npm install
npm link
```

## Basic CLI

Run these commands from a coding project:

```bash
ctx init
ctx remember "Auth state uses Zustand" --type decision --importance 0.9
ctx remember "Public auth API must not change" --type constraint --importance 0.9
ctx remember "Refresh race happens when requests overlap" --type observation

ctx search "authentication refresh"
ctx context "fix authentication refresh race" --budget 4000
ctx snapshot "Fix authentication refresh race" --task "fix authentication refresh race"
ctx show-snapshot
```

The default database is:

```text
<project>/.context/context.db
```

`.context/` is ignored by Git.

## MCP

The MCP server is a local stdio process:

```bash
ctx mcp
```

It exposes three tools:

- `context_get` — retrieve relevant project context for a coding task
- `context_remember` — persist a durable fact/decision/task/constraint/observation/note
- `context_snapshot` — create a compact checkpoint for resume or handoff

### Codex

With a globally installed `ctx` command:

```bash
codex mcp add local-context-store -- ctx mcp
```

### Claude Code

Add a local MCP server using the Claude Code MCP configuration/CLI and point the command at:

```text
ctx mcp
```

If `ctx` is not on PATH, use the absolute path to the repository's CLI or Node executable.

## Intended workflow

### Agent A starts work

```text
context_get("fix auth refresh race")
```

The store returns only relevant durable context.

### Agent A makes an important decision

```text
context_remember(
  type="decision",
  content="Refresh uses a single-flight lock"
)
```

### Agent A stops

```text
context_snapshot("Fix auth refresh race")
```

### Agent B continues tomorrow

```text
context_get("continue auth refresh")
```

Agent B sees the same project context without needing Agent A's full conversation history.

## Data model

The MVP intentionally has only three durable concepts:

```text
items       durable project knowledge
sessions    where an item came from
snapshots   resumable project state
```

Item types:

```text
fact
decision
task
constraint
observation
note
```

The goal is a stable **agent-neutral context layer**, not a general-purpose AI memory system.

## Design principles

1. **Project owns context.** Agents are producers and consumers.
2. **Persist selectively.** Do not mirror every conversation message.
3. **Retrieve for the task.** `context_get` is a task-oriented context pack, not a memory dump.
4. **Stay local.** One SQLite file is easy to inspect, back up, move, and delete.
5. **Stay agent-neutral.** Stored data does not depend on Claude or Codex internals.
6. **MCP is the integration boundary.** Adding another coding agent should not require a database migration.

## Development

```bash
npm install
npm test
```

CI runs the test suite against Node.js 20, 22, and 24.

## Status

Early MVP for real-world testing. The first validation target is simple:

> Can a developer work in Claude Code, stop, switch to Codex, and continue with materially less re-explanation because both agents share the same local project context?

Feedback from actual coding sessions should drive the next schema and retrieval iterations.

## License

MIT
