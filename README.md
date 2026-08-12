# Local Context Store

> **Local Context Store for Coding Agents**

A local-first context layer for Claude Code, Codex, and other coding agents.

## What problem does it solve?

AI coding agents are good at the current conversation, but useful project knowledge is often trapped in one session, one agent, or a collection of Markdown files.

Local Context Store gives the **project** its own persistent context:

```text
Claude Code ─┐
Codex ───────┼── MCP ── Local Context Store ── .context/context.db
Other Agents ┘
```

It focuses on three things:

- **Remember** — save important decisions, constraints, facts, observations, and tasks.
- **Retrieve** — given a coding task, find the most relevant context instead of dumping everything into the prompt.
- **Resume** — save a lightweight snapshot so another agent or another session can continue the work.

The goal is simple:

> **Make project context portable across coding agents and sessions.**

## Why SQLite?

The MVP is deliberately local and simple:

- one database per project
- SQLite + FTS5 for fast local retrieval
- no server
- no cloud dependency
- easy to back up, inspect, move, or delete

Context retrieval currently combines text relevance with importance, recency, and a token budget. The result is a small **Context Pack** that can be given to an agent.

## MVP

```text
remember → SQLite
             ↓
          FTS5 search
             ↓
       relevance ranking
             ↓
        token budget
             ↓
        Context Pack
             ↓
       Claude / Codex
```

MCP is the integration boundary, so the same store can be shared by different coding agents.

## Quick start

```bash
git clone https://github.com/haomiao33/local-context-store.git
cd local-context-store
npm install
npm test
npm link
```

Inside a project:

```bash
ctx init

ctx remember "Auth state uses Zustand" --type decision --importance 0.9
ctx remember "Public auth API must not change" --type constraint --importance 1

ctx context "fix authentication refresh race"
```

The database is created at:

```text
<project>/.context/context.db
```

## CLI reference

Run `ctx --help` or `ctx <command> --help` for the same information in the terminal.

### `ctx init`

Initialize the current project. Creates the local SQLite database at `.context/context.db`.

```bash
ctx init
```

No options.

### `ctx remember <content>`

Save a piece of durable project context.

```bash
ctx remember "Auth uses Zustand" \
  --type decision \
  --importance 0.9
```

Options:

| Option | Default | Meaning |
|---|---:|---|
| `-t, --type <type>` | `note` | Context type. One of `fact`, `decision`, `task`, `constraint`, `observation`, `note`. |
| `-i, --importance <number>` | `0.5` | Importance from `0` (low) to `1` (critical). Used when ranking context. |

Recommended types:

- `fact` — stable project knowledge.
- `decision` — a technical or product decision already made.
- `task` — work that needs to be done or continued.
- `constraint` — something the agent must not violate.
- `observation` — something discovered during development.
- `note` — general durable context.

Examples:

```bash
ctx remember "Auth state uses Zustand" --type decision --importance 0.9
ctx remember "Do not change the public auth API" --type constraint --importance 1
ctx remember "Refresh requests can race" --type observation --importance 0.8
```

### `ctx search <query>`

Search stored context using SQLite FTS5 full-text search.

```bash
ctx search "authentication refresh"
```

Options:

| Option | Default | Meaning |
|---|---:|---|
| `-l, --limit <number>` | `20` | Maximum number of matching records to return. |

Use this when you want to inspect the stored context directly.

### `ctx context <task>`

Build a task-oriented **Context Pack**. This is the main retrieval command.

```bash
ctx context "fix authentication refresh race"
```

The store searches the project context, ranks relevant results using text relevance, importance, and recency, then stops when the approximate token budget is reached.

Options:

| Option | Default | Meaning |
|---|---:|---|
| `-b, --budget <number>` | `8000` | Approximate maximum number of tokens to include in the returned Context Pack. |

Examples:

```bash
ctx context "fix authentication refresh race"
ctx context "refactor payment service" --budget 4000
```

The important distinction:

```text
ctx search
    = inspect search results

ctx context
    = prepare the context an AI agent actually needs
```

### `ctx snapshot <title>`

Save a lightweight checkpoint for resuming work or handing work to another agent.

```bash
ctx snapshot "Auth refresh handoff" \
  --task "fix auth refresh" \
  --goal "preserve the public API"
```

Options:

| Option | Default | Meaning |
|---|---:|---|
| `-t, --task <task>` | none | Current task. Relevant context is included in the snapshot. |
| `-g, --goal <goal>` | none | Goal or intended outcome of the work. |

### `ctx show-snapshot`

Show the latest snapshot for the current project.

```bash
ctx show-snapshot
```

No options.

### `ctx mcp`

Start the local MCP server for Claude Code, Codex, or another MCP-compatible agent.

```bash
ctx mcp
```

The server uses the current working directory as the project and `.context/context.db` as its database.

## Claude Code / Codex

Register `ctx mcp` as a local MCP server. The agent can then use:

```text
context_get       retrieve relevant context for a task
context_remember  save durable project context
context_snapshot  save a resume/handoff checkpoint
```

Claude and Codex do not need to share their conversations. They share the project's context database.

## Development roadmap

### v0.1 — Local Context Store

- SQLite persistence
- FTS5 retrieval
- relevance + importance + recency ranking
- token-budgeted context packs
- snapshots
- MCP integration
- Claude Code / Codex testing

### v0.2 — Better retrieval

- hybrid FTS5 + semantic/vector search
- better ranking
- context lifecycle / expiration
- file and code-symbol awareness
- improved handoff and resume

### v0.3 — Automatic context

- automatic context extraction from agent sessions
- automatic remember of important decisions and constraints
- automatic task bootstrap
- automatic snapshots
- agent hooks where useful

### Future

- richer project knowledge model
- optional local UI
- sync / team sharing
- more coding-agent integrations

The roadmap should be driven by real coding-agent usage rather than by adding infrastructure for its own sake.

## Core principle

**The agent owns the reasoning. The project owns the context.**

## Status

Early MVP. The first question we want to answer is:

> Can a developer switch between Claude Code, Codex, and sessions with materially less re-explanation because the project keeps its own context?

## License

MIT
