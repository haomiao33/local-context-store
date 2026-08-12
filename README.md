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

The store is deliberately local and simple:

- one database per project
- SQLite + FTS5 for fast local retrieval
- optional local embeddings for semantic retrieval
- no API key or hosted vector database
- easy to back up, inspect, move, or delete

The default semantic model runs locally through ONNX. The model is downloaded once on first semantic use and cached locally; inference does not call an embedding API. Quantized `q8` inference is used by default to keep resource usage low.

## v0.1 retrieval

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

## v0.2-alpha retrieval

Semantic retrieval is deliberately modular. FTS5 remains responsible for exact terms such as API names, symbols, error codes, and file names; local embeddings add fuzzy semantic matching.

```text
                 Query
                   │
          ┌────────┴────────┐
          ↓                 ↓
        FTS5        Local Embedding
     lexical match   semantic match
          │                 │
          └────────┬────────┘
                   ↓
             Hybrid Ranking
                   ↓
              Token Budget
                   ↓
              Context Pack
```

The first alpha keeps the vector side intentionally simple:

- local ONNX embedding model
- 384-dimensional vectors by default
- SQLite BLOB persistence
- cosine similarity in-process
- FTS5 + semantic hybrid ranking
- no separate vector database

`ctx context` keeps the v0.1 path by default. Use `--semantic` to enable the v0.2-alpha hybrid path:

```bash
ctx context "fix authentication refresh race" --semantic
```

The semantic path lazily indexes missing embeddings. Subsequent queries reuse the stored vectors.

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

Options:

| Option | Default | Meaning |
|---|---:|---|
| `-b, --budget <number>` | `8000` | Approximate maximum number of tokens to include in the returned Context Pack. |
| `--semantic` | off | Add local embedding retrieval and hybrid ranking. No embedding API is used. |

Examples:

```bash
ctx context "fix authentication refresh race"
ctx context "fix authentication refresh race" --semantic
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

## v0.2 benchmark

The repository includes a repeatable local benchmark for the retrieval path. It creates temporary deterministic databases, measures FTS5 and Context Pack latency at different corpus sizes, and measures in-memory vector search separately.

```bash
npm run benchmark
```

Default corpus sizes:

```text
1,000
10,000
100,000 context items
```

Useful options:

```bat
set LCS_BENCH_SIZES=1000,10000,100000
set LCS_BENCH_QUERIES=30
set LCS_BENCH_VECTOR_DIMS=32
npm run benchmark
```

To measure the actual local ONNX embedding model, including cold start, warm latency, and RSS growth:

```bat
set LCS_BENCH_LOCAL_EMBED=1
npm run benchmark
```

The important numbers are:

- **FTS p50 / p95** — lexical retrieval latency.
- **Context p50 / p95** — time to construct the token-budgeted Context Pack.
- **Vector p50 / p95** — in-memory semantic candidate scan latency.
- **Cold embedding** — first local model inference, including model initialization.
- **Warm embedding p50 / p95** — repeated local inference after initialization.
- **RSS delta** — approximate process memory increase during local embedding initialization.

This benchmark is intentionally not a synthetic promise of production performance. Run it on the machines that matter. The target is simple: **fast local retrieval, low resource usage, and predictable latency as the context store grows.**

## Development

Run the full regression suite:

```bash
npm test
```

The v0.2 test suite covers persistence, FTS5 retrieval, token budgets, local embeddings, embedding persistence/invalidation, hybrid ranking, SQLite retry behavior, concurrent database initialization, and multi-process concurrent readers/writers.
