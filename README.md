# Local Context Store

> **Persistent, local-first context for coding agents.**

Local Context Store gives a coding project a small, durable memory layer that works across **Claude Code, Codex, and other MCP-compatible agents**.

It stores project context in SQLite, retrieves it locally, and returns a task-focused **Context Pack** instead of forcing an agent to reload the whole project history.

```text
Claude Code ─┐
Codex ───────┼── MCP ── Local Context Store ── .context/context.db
Other Agents ┘
```

## What it does

- **Remember** — persist facts, decisions, constraints, tasks, observations, and notes.
- **Retrieve** — search by exact terms with SQLite FTS5; optionally add local semantic retrieval.
- **Resume** — save lightweight snapshots that another session or another agent can continue from.
- **Stay local** — the database and embedding model run on your machine. No hosted vector database and no embedding API are required.

The design favors **recall and portability over aggressive approximation**. The hybrid retrieval path does not use semantic Top-K truncation; lexical and semantic candidates are merged before ranking and the final Context Pack is constrained by the requested token budget.

---

## Install

Requires **Node.js 20+**.

```bash
npm install -g local-context-store
```

Verify:

```bash
ctx --help
ctx init
```

The project database is created at:

```text
<project>/.context/context.db
```

### Development install

```bash
git clone https://github.com/haomiao33/local-context-store.git
cd local-context-store
npm install
npm test
npm link
```

---

## Quick start

Inside the project you want the agent to remember:

```bash
ctx init

ctx remember "Auth state uses Zustand" --type decision --importance 0.9
ctx remember "Public auth API must not change" --type constraint --importance 1
ctx remember "Refresh requests can race during tab restore" --type observation

ctx search "authentication refresh"
ctx context "fix authentication refresh race"
```

For semantic + lexical hybrid retrieval:

```bash
ctx model install
ctx context "fix authentication refresh race" --semantic
```

The first semantic query may be slower because missing embeddings are generated and persisted. Repeated queries reuse those embeddings.

---

## How retrieval works

### Default: lexical retrieval

```text
Task
  │
  ▼
SQLite FTS5
  │
  ▼
Lexical ranking
  │
  ▼
Token budget
  │
  ▼
Context Pack
```

This path is especially good for exact technical identifiers: function names, API names, error codes, package names, file names, and symbols.

### Optional: hybrid retrieval

```text
                    Task
                      │
             ┌────────┴────────┐
             ▼                 ▼
           FTS5        Local ONNX embedding
       lexical match     semantic match
             │                 │
             └────────┬────────┘
                      ▼
               Candidate union
                      ▼
                Hybrid ranking
                      ▼
                 Token budget
                      ▼
                 Context Pack
```

The current semantic model is:

- `onnx-community/all-MiniLM-L6-v2-ONNX`
- `q4` quantized inference
- 384-dimensional embeddings
- ONNX Runtime through Transformers.js
- cosine similarity in-process
- embeddings persisted in SQLite

**Important:** the hybrid path intentionally does **not** discard semantic candidates with a Top-K prefilter. The retrieval stage keeps the full candidate set available to hybrid ranking. The `--budget` option limits what is returned to the agent, not what is considered during retrieval.

---

## Scale and benchmark

The repository contains a deterministic benchmark for the retrieval engine. It measures lexical retrieval, Context Pack construction, synthetic vector search, hybrid ranking, and the real local embedding model.

Run it with:

```bash
npm run benchmark
```

For the real local embedding measurement:

```bat
set HF_HUB_OFFLINE=1
set LCS_BENCH_LOCAL_EMBED=1
npm run benchmark
```

### Measured baseline

The following results were measured locally on the current v0.2 development build. Latency is machine-dependent; use them as an order-of-magnitude reference, not a universal SLA.

| Workload | Size | p50 | p95 | Notes |
|---|---:|---:|---:|---|
| FTS5 search | 1,000 | 1.14 ms | 2.09 ms | lexical retrieval |
| Context Pack | 1,000 | 3.60 ms | 4.84 ms | lexical path |
| FTS5 search | 10,000 | 6.95 ms | 13.90 ms | lexical retrieval |
| Context Pack | 10,000 | 13.90 ms | 22.91 ms | lexical path |
| FTS5 search | 100,000 | 113.21 ms | 192.10 ms | lexical retrieval |
| Context Pack | 100,000 | 192.10 ms | 416.65 ms | lexical path |
| Synthetic vector search | 100,000 | 336.35 ms | 351.21 ms | 32-dimensional in-memory vectors |
| Local model warm embedding | — | 7.52 ms | 16.09 ms | 384 dimensions |
| Hybrid search | 1,000 | **47.70 ms** | **78.64 ms** | local q4 model, warm query path |
| Hybrid search | 10,000 | **400.96 ms** | **459.26 ms** | local q4 model, warm query path |

Local-model indexing is intentionally measured separately because it is a one-time cost for missing embeddings:

| Hybrid workload | Indexed | Index time |
|---|---:|---:|
| 1,000 items | 1,000 / 1,000 | ~9.3 s |
| 10,000 items | 10,000 / 10,000 | ~107 s |

The benchmark currently caps **full local semantic indexing at 10,000 items** so running `npm run benchmark` does not silently create a large embedding workload. The lexical engine itself is benchmarked at **100,000 items**.

### What these numbers mean

For a project-sized context store, the useful distinction is:

- **1k items:** hybrid retrieval is comfortably interactive.
- **10k items:** hybrid retrieval is still practical, with roughly **0.4 s p50** on the reference machine; indexing is the expensive part and embeddings are persisted.
- **100k items:** the lexical path remains usable and predictable; the current release does not claim a full 100k local-semantic indexing benchmark.

The current implementation deliberately avoids trading recall for a faster semantic Top-K stage. If a future release adds approximate vector indexing, it should be introduced as an explicit optimization with recall measurements rather than silently changing the retrieval semantics.

---

## CLI reference

Run `ctx --help` or `ctx <command> --help` for the same information directly in the terminal.

### `ctx init`

Initialize the current project.

```bash
ctx init
```

Creates `.context/context.db` if it does not already exist.

### `ctx remember <content>`

Store durable project context.

```bash
ctx remember "Auth uses Zustand" --type decision --importance 0.9
```

Options:

| Option | Default | Values / meaning |
|---|---:|---|
| `-t, --type <type>` | `note` | `fact`, `decision`, `task`, `constraint`, `observation`, `note` |
| `-i, --importance <number>` | `0.5` | `0` to `1`; higher values rank more strongly |

Use `decision` for architectural choices, `constraint` for rules that must not be violated, and `observation` for useful discoveries that may matter later.

### `ctx search <query>`

Exact-term retrieval through SQLite FTS5.

```bash
ctx search "authentication refresh"
ctx search "public API" --limit 10
```

| Option | Default | Meaning |
|---|---:|---|
| `-l, --limit <number>` | `20` | Maximum number of lexical search results returned |

`search` is a direct search command. It does not perform semantic retrieval.

### `ctx context <task>`

Build the task-oriented Context Pack. This is the main command agents should use when they need project context.

```bash
ctx context "fix authentication refresh race"
ctx context "fix authentication refresh race" --semantic
ctx context "refactor payment service" --budget 4000
```

| Option | Default | Meaning |
|---|---:|---|
| `-b, --budget <number>` | `8000` | Approximate token budget for the returned Context Pack |
| `--semantic` | off | Add local ONNX semantic retrieval and hybrid ranking |

`--budget` controls the final context pack. It is **not** a semantic Top-K parameter.

### `ctx model status`

Show the local embedding model status and required files.

```bash
ctx model status
```

### `ctx model install`

Install the default q4 model.

```bash
ctx model install
```

For a manually downloaded model directory:

```bash
ctx model install --source C:\models\all-MiniLM-L6-v2-ONNX
```

`--source` copies the required model files and does not use the network.

### `ctx model remove`

Remove the shared local model.

```bash
ctx model remove
```

### `ctx snapshot <title>`

Create a lightweight checkpoint for resuming or handing work to another agent.

```bash
ctx snapshot "Auth refresh handoff" \
  --task "fix authentication refresh" \
  --goal "preserve the public API"
```

Options:

| Option | Default | Meaning |
|---|---|---|
| `-g, --goal <goal>` | none | Goal or desired outcome |
| `-t, --task <task>` | none | Current task; related lexical context is included |

### `ctx show-snapshot`

Show the latest checkpoint:

```bash
ctx show-snapshot
```

### `ctx mcp`

Start the MCP server over stdio.

```bash
ctx mcp
```

The MCP server uses the **current working directory** as the project and `.context/context.db` as the database.

---

## Claude Code

Claude Code supports MCP servers through its `claude mcp` command. The recommended project-scoped setup is:

```bash
claude mcp add local-context-store --scope project -- npx -y local-context-store mcp
```

Then verify:

```bash
claude mcp list
claude mcp get local-context-store
```

Start Claude Code from the project root:

```bash
cd your-project
claude
```

The MCP server exposes these tools:

- `context_get` — retrieve durable context for a task.
- `context_remember` — save durable project context.
- `context_snapshot` — create a resume/handoff checkpoint.

Typical workflow inside Claude Code:

```text
1. Start Claude Code in the project root.
2. Retrieve project context before a non-trivial task.
3. Remember important decisions or constraints as they are discovered.
4. Create a snapshot when handing work to another session or agent.
```

### Claude Code project configuration

The project-scoped command above writes the MCP configuration for the project. If you prefer to inspect it manually, the generated configuration is equivalent to:

```json
{
  "mcpServers": {
    "local-context-store": {
      "command": "npx",
      "args": ["-y", "local-context-store", "mcp"]
    }
  }
}
```

---

## Codex CLI

Codex CLI supports stdio MCP servers through `codex mcp add`.

```bash
codex mcp add local-context-store -- npx -y local-context-store mcp
```

Verify:

```bash
codex mcp list
codex mcp get local-context-store
```

Then start Codex in the project:

```bash
cd your-project
codex
```

The same server can also be configured in `~/.codex/config.toml`:

```toml
[mcp_servers.local-context-store]
command = "npx"
args = ["-y", "local-context-store", "mcp"]
enabled = true
```

For a project-specific Codex configuration, use the project's supported `.codex/config.toml` configuration when appropriate.

---

## Environment variables

### `LCS_MODEL_DIR`

Override the shared model directory.

Windows:

```bat
set LCS_MODEL_DIR=D:\models\local-context-store
```

macOS / Linux:

```bash
export LCS_MODEL_DIR=/data/models/local-context-store
```

Default locations:

| Platform | Default |
|---|---|
| Windows | `%LOCALAPPDATA%/local-context-store/models` |
| macOS | `~/Library/Application Support/local-context-store/models` |
| Linux | `$XDG_DATA_HOME/local-context-store/models`, or `~/.local/share/local-context-store/models` |

### `LOCAL_CONTEXT_PROJECT`

Override the project directory used by the MCP server. Normally you do not need this because `ctx mcp` uses the current working directory.

```bash
LOCAL_CONTEXT_PROJECT=/absolute/path/to/project ctx mcp
```

### `HF_HUB_OFFLINE`

Useful for explicitly testing offline local-model operation:

```bat
set HF_HUB_OFFLINE=1
```

The model itself is installed locally by `ctx model install` or `ctx model install --source ...`; semantic inference does not require an embedding API.

### Benchmark variables

`LCS_BENCH_LOCAL_EMBED=1` enables the real local-model section of the benchmark.

```bat
set LCS_BENCH_LOCAL_EMBED=1
npm run benchmark
```

---

## Local model management

The default semantic model is installed once per user machine and shared across projects.

```text
Project A ─┐
Project B ─┼── shared local model directory
Project C ─┘
```

Check it:

```bash
ctx model status
```

A successful installation reports:

```text
Model: onnx-community/all-MiniLM-L6-v2-ONNX
Dtype: q4
Status: installed
```

For offline/manual installation, download the required model directory and use `--source`:

```bash
ctx model install --source /path/to/all-MiniLM-L6-v2-ONNX
```

---

## Data and privacy

The core store is local:

- project context lives in `.context/context.db`
- semantic embeddings are persisted in the same SQLite database
- the embedding model is stored locally
- no hosted vector database is required
- no embedding API key is required

The model download itself can come from Hugging Face when using the default installer. If you require a fully offline setup, install from a local model directory with `--source` and set `HF_HUB_OFFLINE=1` for your environment.

---

## Development

Run the full regression suite:

```bash
npm test
```

Current regression coverage includes:

- SQLite persistence and snapshots
- FTS5 lexical retrieval
- Context Pack token budgets
- local embedding generation and normalization
- embedding persistence and invalidation
- hybrid lexical + semantic retrieval
- hybrid ranking determinism and secondary signals
- model installation/status/removal
- SQLite `BUSY` / `LOCKED` retry behavior
- concurrent writers/readers
- concurrent project initialization

Current baseline: **50 tests, 50 passing**.

Run the benchmark:

```bash
npm run benchmark
```

---

## Release notes for the v0.2 alpha

The v0.2 alpha adds local semantic retrieval on top of the existing FTS5 path. It intentionally keeps the architecture simple:

- SQLite remains the only database.
- FTS5 remains the exact-match retrieval path.
- ONNX embeddings are local and persisted.
- Hybrid ranking combines lexical and semantic candidates.
- No hosted embedding service is required.
- No semantic Top-K prefilter is used.

The benchmark numbers above are the current reference point for this architecture.

---

## License

MIT
