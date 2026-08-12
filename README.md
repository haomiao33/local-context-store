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

## Claude Code / Codex

The store exposes an MCP server:

```bash
ctx mcp
```

Register that command as a local MCP server in Claude Code or Codex. The agent can then use:

```text
context_get
context_remember
context_snapshot
```

The important part is that **Claude and Codex do not need to share their conversations**. They share the project's context database.

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
