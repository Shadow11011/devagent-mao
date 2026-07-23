# SANDBOX-INTERFACE — the Shiro contract

> The orchestrator's only dependency on the outside world. Everything in MAO's coordinator talks to Shiro through this contract. Build the orchestrator against the **mock adapter** until the real Shiro confirms it can honor every call.

## Identity & lifecycle

Every sandbox has a string `id`. Lifecycle is a state machine:

```
creating → ready → running → collecting → done | failed → destroyed
                     └────────── crashed (infra) ──┘
```

## API surface (REST over HTTP, JSON)

### `POST /sandbox`
Create a sandbox.

```json
// request
{
  "workdir": "/abs/path/to/project",
  "files": ["src/app.ts", "src/models/user.ts"],   // scoped mount, NOT full repo
  "env": { "NODE_ENV": "development" },
  "limits": { "ramMb": 2048, "cpus": 2, "pids": 256 },
  "engine": "auto"   // auto | linux | macos | windows | fallback
}
// response 201
{
  "id": "sbx_a3f2",
  "engine": "linux",
  "state": "ready",
  "mountPath": "/tmp/shiro/sbx_a3f2"
}
```

### `POST /sandbox/{id}/exec`
Run a command (usually the jcode worker).

```json
// request
{ "cmd": "jcode --task ... --model v4-flash --workdir .",
  "timeoutMs": 300000 }
// response 200 (streaming via WebSocket for PTY, or buffered)
{ "exitCode": 0, "state": "running" }
```

### `GET /sandbox/{id}/diff`
Extract output as a git diff against the baseline commit.

```json
// response 200
{ "new": ["src/routes/auth.ts"],
  "edited": ["src/app.ts"],
  "diff": "<unified diff text>",
  "tokens": 1200, "durationMs": 32000 }
```

### `GET /sandbox/{id}/files?path=...`
Read a file inside the sandbox (for the file browser + coupling inputs). Path traversal outside the mount = 403.

### `POST /sandbox/{id}/snapshot` / `POST /sandbox/{id}/restore`
Checkpoint/rollback (used by the retry path — snapshot before quality gate, restore on retry).

### `DELETE /sandbox/{id}`
Kill + destroy. Guarantees: process tree dead, temp files wiped, only already-extracted output survives.

### `GET /sandbox/{id}/health`
```json
{ "state": "running", "ramMb": 612, "cpuPct": 43, "pidCount": 12 }
```

## Failure codes

| Code | Meaning | Coordinator action |
|------|---------|--------------------|
| `OOM` | hit ramMb limit | auto-restart with serialized concurrency, no retry penalty |
| `TIMEOUT` | exec exceeded timeoutMs | kill, treat as failed attempt |
| `CRASH` | sandbox process died | auto-restart, no retry penalty |
| `MOUNT_FAIL` | couldn't stage files | orchestrator re-scopes |
| `EXEC_FAIL` | exitCode ≠ 0 | worker failed the task → OKF + retry logic |
| `ENGINE_UNAVAILABLE` | requested engine missing | fall back per engine table |

## Rust adapter (in `agent/` or `mao/`)

```rust
trait SandboxAdapter {
    async fn spawn(&self, spec: SpawnSpec) -> Result<SandboxId, SandboxError>;
    async fn exec(&self, id: &SandboxId, cmd: &str, timeout: Duration) -> Result<ExitCode, SandboxError>;
    async fn diff(&self, id: &SandboxId) -> Result<Diff, SandboxError>;
    async fn read_file(&self, id: &SandboxId, path: &Path) -> Result<String, SandboxError>;
    async fn snapshot(&self, id: &SandboxId) -> Result<SnapshotId, SandboxError>;
    async fn restore(&self, id: &SandboxId, snap: &SnapshotId) -> Result<(), SandboxError>;
    async fn kill(&self, id: &SandboxId) -> Result<(), SandboxError>;
    async fn health(&self, id: &SandboxId) -> Result<Health, SandboxError>;
}
```

Implementations:
1. `MockSandboxAdapter` — **build first.** Local dir copies + child processes, no isolation. Dev-only, lets the whole coordinator be built without Shiro.
2. `ShiroHttpAdapter` — the real one, hits the contract above.
3. `MicrosandboxAdapter` — fallback if Shiro's isolation turns out to be containers (security hard-requirement).

## Source & status
The Shiro engine is a **restructure of `Joshua07q/shiro-cloud-workstation`** (MIT, Rust) — a file-sync system we strip and rebuild as the sandbox runtime. The transformation plan is in [SHIRO-RESTRUCTURE.md](SHIRO-RESTRUCTURE.md). Nothing below depends on the friend's roadmap; we own the fork. The mock adapter is built first regardless.
