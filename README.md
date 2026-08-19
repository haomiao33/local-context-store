# Local Context Store

> Persistent, local-first context for coding agents.

Local Context Store gives a coding project a durable memory layer for **Claude Code, Codex, and other MCP-compatible agents**.

It stores context in SQLite, retrieves it locally, and returns a task-focused **Context Pack** instead of forcing an agent to reload the whole project history.

```text
Claude Code ─┐
Codex ───────┼── MCP ── Local Context Store ── .context/context.db
Other Agents ┘
```

## What it does

- **Remember** — facts, decisions, constraints, tasks, observations, and notes.
- **Retrieve** — SQLite FTS5 lexical search, with optional local semantic retrieval.
- **Resume** — lightweight snapshots for handing work between sessions or agents.
- **Stay local** — SQLite, embeddings, and the q4 embedding model run locally.

The design favors **recall over aggressive approximation**. Hybrid retrieval does **not** use a semantic Top-K prefilter: lexical and semantic candidates are merged before ranking, and only the final Context Pack is constrained by the requested token budget.

---

## Install

Requires **Node.js 20+**.

```bash
npm install -g local-context-store
```

Verify the CLI:

```bash
lcs --help
lcs init
```

If your shell reports `lcs: command not found`, npm's global bin directory is not
on your `PATH`. Check where npm puts it and add it:

```bash
npm config get prefix          # e.g. /opt/node or ~/.nvm/versions/node/v22.14.0
export PATH="$(npm config get prefix)/bin:$PATH"
```

Add that `export` line to your shell profile to make it permanent. Note that on
Debian/Ubuntu `~/.bashrc` returns early for non-interactive shells, so put it in
`~/.profile` as well if scripts need to find `lcs`.

The project database is created at:

```text
<project>/.context/context.db
```

### Development

```bash
git clone https://github.com/haomiao33/local-context-store.git
cd local-context-store
npm install
npm test
npm link
```

After `npm link`, the executable is `lcs`.

---

## Quick start

Inside the project you want the agent to remember:

```bash
lcs init

lcs remember "Auth state uses Zustand" --type decision --importance 0.9
lcs remember "Public auth API must not change" --type constraint --importance 1
lcs remember "Refresh requests can race during tab restore" --type observation

lcs search "authentication refresh"
lcs context "fix authentication refresh race"
```

For lexical + semantic hybrid retrieval:

```bash
lcs context "fix authentication refresh race" --semantic
```

That is the whole setup. The q4 embedding model ships inside the npm package and
is read directly from there, so `--semantic` works offline on a fresh install
with nothing to install, nothing to download, and no second copy on disk.
`lcs model status` reports `available (shipped with the package)`.

The model directory is resolved in this order:

1. the user data directory — only populated by `lcs model install`, so an explicit install always wins
2. the copy shipped in the package

`LCS_MODEL_DIR` overrides the user data directory. `lcs model install` is needed
only for a source checkout without `model/`; it downloads from
`raw.githubusercontent.com/haomiao33/local-context-store`, then
`huggingface.co/onnx-community/all-MiniLM-L6-v2-ONNX`, and if every source fails
the error lists each attempt so you can pick one and pass it via `--source`.

The first semantic query can be slower because missing embeddings are generated and persisted. Repeated queries reuse persisted embeddings.

---

## Retrieval architecture

### Default lexical path

```text
Task → SQLite FTS5 → lexical ranking → token budget → Context Pack
```

This is particularly effective for exact technical identifiers: function names, API names, error codes, package names, file names, and symbols.

### Optional hybrid path

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

Current semantic model:

- `onnx-community/all-MiniLM-L6-v2-ONNX`
- q4 quantized inference
- 384-dimensional embeddings
- Transformers.js / ONNX Runtime
- cosine similarity in-process
- embeddings persisted in SQLite

**No semantic Top-K prefilter is used.** `--budget` limits the final context returned to the agent; it does not silently reduce the semantic candidate set before ranking.

---

## Scale and benchmark

Run the deterministic benchmark:

```bash
npm run benchmark
```

For the real local-model measurement on Windows:

```bat
set HF_HUB_OFFLINE=1
set LCS_BENCH_LOCAL_EMBED=1
npm run benchmark
```

### Reference measurements

These were measured locally on the current v0.2 development build. They are reference numbers, not an SLA.

| Workload | Size | p50 | p95 |
|---|---:|---:|---:|
| FTS5 search | 1,000 | 1.14 ms | 2.09 ms |
| Context Pack | 1,000 | 3.60 ms | 4.84 ms |
| FTS5 search | 10,000 | 6.95 ms | 13.90 ms |
| Context Pack | 10,000 | 13.90 ms | 22.91 ms |
| FTS5 search | 100,000 | 113.21 ms | 192.10 ms |
| Context Pack | 100,000 | 192.10 ms | 416.65 ms |
| Synthetic vector search | 100,000 | 336.35 ms | 351.21 ms |
| Local model warm embedding | — | 7.52 ms | 16.09 ms |
| Hybrid search | 1,000 | **47.70 ms** | **78.64 ms** |
| Hybrid search | 10,000 | **400.96 ms** | **459.26 ms** |

Local semantic indexing is the expensive one-time operation for missing embeddings:

| Items | Indexed | Index time |
|---|---:|---:|
| 1,000 | 1,000 / 1,000 | ~9.3 s |
| 10,000 | 10,000 / 10,000 | ~107 s |

The benchmark intentionally caps full local semantic indexing at **10,000 items**. The lexical engine itself is benchmarked at **100,000 items**.

Practical interpretation:

- **1k items:** hybrid retrieval is comfortably interactive.
- **10k items:** hybrid retrieval is practical at roughly 0.4 s p50 on the reference machine; indexing is the expensive part and embeddings persist.
- **100k items:** the lexical path remains usable; the current release does not claim a full 100k local-semantic indexing benchmark.

The implementation intentionally does not trade recall for a faster semantic Top-K stage.

---

## CLI reference

The executable is **`lcs`**.

### `lcs init`

Initialize the current project:

```bash
lcs init
```

### `lcs status`

Show what this project remembers and whether an agent can actually retrieve it:

```bash
lcs status
```

```text
Runtime
  lcs            0.4.0
  Model          available (shipped with the package) · q4 · 384d
  Path           .../local-context-store/model/onnx-community/all-MiniLM-L6-v2-ONNX

Project  /work/api
  Database       /work/api/.context/context.db  (84 KB)
  Items          3   constraint 1 · decision 1 · observation 1
  High-signal    2 at importance >= 0.8
  Updated        newest just now · oldest 4d ago
  Sessions       0
  Snapshots      1   latest "Auth refresh handoff" (2h ago)

Retrieval
  FTS index      3 / 3 indexed
  Embeddings     3 / 3 current
                 onnx-community/all-MiniLM-L6-v2-ONNX
```

The **Retrieval** block is the part worth watching:

- **FTS index** — when fewer items are indexed than exist, `search` and `context` silently miss the difference.
- **Embeddings** — how many items have a vector for the current model whose content hash still matches. Missing or stale ones are recomputed on the next `--semantic` run.

A project id is the absolute path of the project directory, so `--project` takes
that directory and reads its database:

```bash
lcs status --project ~/work/api
```

`--json` emits the same data for agents and scripts:

```bash
lcs status --json
```

### `lcs remember <content>`

Store durable project context:

```bash
lcs remember "Auth uses Zustand" --type decision --importance 0.9
```

| Option | Default | Values / meaning |
|---|---:|---|
| `-t, --type <type>` | `note` | `fact`, `decision`, `task`, `constraint`, `observation`, `note` |
| `-i, --importance <number>` | `0.5` | `0` to `1`; higher values rank more strongly |

### `lcs search <query>`

Direct SQLite FTS5 search:

```bash
lcs search "authentication refresh"
lcs search "public API" --limit 10
```

| Option | Default | Meaning |
|---|---:|---|
| `-l, --limit <number>` | `20` | Maximum lexical results |

`search` does not perform semantic retrieval.

### `lcs context <task>`

Build the task-oriented Context Pack. This is the main retrieval command:

```bash
lcs context "fix authentication refresh race"
lcs context "fix authentication refresh race" --semantic
lcs context "refactor payment service" --budget 4000
```

| Option | Default | Meaning |
|---|---:|---|
| `-b, --budget <number>` | `8000` | Approximate token budget for the returned Context Pack |
| `--semantic` | off | Add local ONNX semantic retrieval and hybrid ranking |

`--budget` is an output budget, **not a semantic Top-K parameter**.

### `lcs model status`

```bash
lcs model status
```

Shows which copy of the model will be loaded, its dtype, path, and required
files. On an npm install this reports `available (shipped with the package)`
without any setup step.

### `lcs model install`

Not needed for normal use — the packaged model is read in place. Use it for a
source checkout without `model/`, or to override the packaged copy:

```bash
lcs model install
```

For a manually downloaded model directory:

```bash
lcs model install --source C:\models\all-MiniLM-L6-v2-ONNX
```

`--source` copies an already-downloaded model and does not use the network.
Either way the model lands in the user data directory, which takes precedence
over the packaged copy.

### `lcs model remove`

```bash
lcs model remove
```

Removes only the user data directory copy. The model shipped with the package is
untouched and stays available, so `--semantic` keeps working.

Removes the shared local embedding model.

### `lcs snapshot <title>`

Create a lightweight checkpoint:

```bash
lcs snapshot "Auth refresh handoff" --task "fix auth refresh" --goal "preserve public API"
```

Options:

| Option | Default | Meaning |
|---|---|---|
| `-g, --goal <goal>` | none | Goal or desired outcome |
| `-t, --task <task>` | none | Current task; related context is included |

### `lcs show-snapshot`

```bash
lcs show-snapshot
```

Shows the latest checkpoint.

### `lcs mcp`

Start the MCP server over stdio:

```bash
lcs mcp
```

The server uses the **current working directory** as the project and `.context/context.db` as the database.

---

## Claude Code

Add the MCP server at project scope:

```bash
claude mcp add local-context-store --scope project -- npx -y local-context-store mcp
```

Verify it:

```bash
claude mcp list
claude mcp get local-context-store
```

Then start Claude Code from the project root:

```bash
cd your-project
claude
```

The MCP server exposes:

- `context_get` — retrieve durable context for a task.
- `context_remember` — save durable project context.
- `context_snapshot` — create a resume/handoff checkpoint.

Typical workflow:

```text
1. Start Claude Code in the project root.
2. Retrieve context before a non-trivial task.
3. Remember important decisions and constraints as they are discovered.
4. Create a snapshot when handing work to another session or agent.
```

---

## Codex CLI

Add the stdio MCP server:

```bash
codex mcp add local-context-store -- npx -y local-context-store mcp
```

Verify:

```bash
codex mcp list
codex mcp get local-context-store
```

Then start Codex in the project root:

```bash
cd your-project
codex
```

Equivalent `~/.codex/config.toml` configuration:

```toml
[mcp_servers.local-context-store]
command = "npx"
args = ["-y", "local-context-store", "mcp"]
enabled = true
```

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

### `LOCAL_CONTEXT_PROJECT`

Override the project directory used by the MCP server:

```bash
LOCAL_CONTEXT_PROJECT=/absolute/path/to/project lcs mcp
```

Normally this is unnecessary because `lcs mcp` uses the current working directory.

### `HF_HUB_OFFLINE`

Explicitly test offline local-model operation:

```bat
set HF_HUB_OFFLINE=1
```

### `LCS_BENCH_LOCAL_EMBED`

Enable the real local-model benchmark section:

```bat
set LCS_BENCH_LOCAL_EMBED=1
npm run benchmark
```

---

## Data and privacy

The core store is local:

- project context lives in `.context/context.db`
- embeddings are persisted in the same SQLite database
- the embedding model is stored locally
- no hosted vector database is required
- no embedding API key is required

An npm install is already fully offline: the model ships with the package and is never fetched. For a source checkout, install the model from a local directory with `lcs model install --source ...`.

---

## Development

Run the regression suite:

```bash
npm test
```

The suite covers SQLite persistence, FTS5 retrieval, Context Pack budgets, embeddings, hybrid retrieval/ranking, model management, SQLite lock retries, concurrency, and project initialization.

Run the benchmark:

```bash
npm run benchmark
```

---

## Release notes

The v0.2 alpha adds local semantic retrieval on top of FTS5 while keeping the architecture deliberately simple:

- SQLite remains the database.
- FTS5 remains the exact-match retrieval path.
- ONNX embeddings are local and persisted.
- Hybrid ranking combines lexical and semantic candidates.
- No hosted embedding service is required.
- No semantic Top-K prefilter is used.
- The CLI command is **`lcs`**.

## License

MIT
