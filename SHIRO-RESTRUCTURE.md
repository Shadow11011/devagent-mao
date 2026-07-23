# SHIRO-RESTRUCTURE — from file-sync to sandbox engine

> Source: `Joshua07q/shiro-cloud-workstation` (MIT, 100% Rust).
> Target: the Shiro sandbox engine from BUILD.md. We strip the sync logic and rebuild the skeleton as the isolation/runtime layer. Forked into this repo as `shiro/`.

## What the source gives us

| Source piece | What it is today | What it becomes |
|---|---|---|
| `shiro-relay` (Axum + SQLite + Tokio) | REST coordination server, device registry, heartbeat | **shiro-server** — the sandbox API |
| `shiro-agent` (notify watcher, debounce, daemon lifecycle) | file-sync daemon | **shiro-engine** — isolation library (NOT a daemon) |
| SQLite `changes` table | pending file changes | sandbox state + diff records |
| Device registry (UUID, online, last_seen) | tracks devices | **sandbox registry** (a sandbox is a registry entry) |
| Heartbeat loop | device liveness | sandbox health checks |
| Shutdown handling | graceful daemon exit | sandbox cleanup on kill/destroy |

## What gets stripped

| Strip | Why |
|---|---|
| File watcher (`notify`, debounce, batch) | Output extraction is git-diff, not file watching |
| `/sync/push`, `/sync/pull`, `/sync/diff` endpoints | Replaced by sandbox lifecycle endpoints |
| Three-way sync, conflict strategies | Coupling is MAO's job, not Shiro's |
| Initial-sync / boot-restore logic | No cross-device sync in the sandbox world |
| Agent-as-daemon model | Engine becomes a library crate; server calls it in-process |

## What gets added

| Add | Purpose |
|---|---|
| `engines/linux.rs` | bwrap namespaces + cgroups v2 + overlayfs |
| `engines/macos.rs` | sandbox-exec + APFS clone + watchdog |
| `engines/windows.rs` | WSL2 detect → delegate to linux engine |
| `engines/fallback.rs` | dir copy + child process + git (dev only) |
| Workspace staging | overlayfs/APFS CoW copy of project + scoped file mount |
| `exec` with PTY | run jcode inside, stream output over WebSocket |
| Output extraction | `git init` baseline at spawn → `git diff` at collect |
| Snapshot service | overlay upper / APFS clone / git commit |
| Resource limits | cgroups v2 (RAM/CPU/PIDs) per spawn spec |
| Failure taxonomy | OOM / TIMEOUT / CRASH / MOUNT_FAIL / EXEC_FAIL / ENGINE_UNAVAILABLE |

## End-state structure

```
shiro/
├── Cargo.toml               ← workspace
├── shiro-server/            ← was shiro-relay
│   └── src/
│       ├── main.rs
│       ├── config.rs
│       ├── store.rs         ← SQLite: sandboxes, states, usage
│       └── api/
│           ├── sandbox.rs   ← POST /sandbox, GET diff, DELETE kill
│           ├── exec.rs      ← POST /sandbox/{id}/exec + WS stream
│           ├── files.rs     ← GET /sandbox/{id}/files (traversal-safe)
│           ├── snapshot.rs  ← POST snapshot/restore
│           └── health.rs    ← GET /sandbox/{id}/health, /health
└── shiro-engine/            ← was shiro-agent, now a lib crate
    └── src/
        ├── lib.rs
        ├── engine.rs        ← Engine trait (create/exec/diff/kill/snapshot)
        ├── staging.rs       ← CoW workspace setup + scoped mounts
        ├── limits.rs        ← cgroups v2 wrapper
        ├── pty.rs           ← PTY attach + stream
        └── engines/
            ├── linux.rs
            ├── macos.rs
            ├── windows.rs
            └── fallback.rs
```

One binary: `shiro-server`. MAO's coordinator calls it over REST (SANDBOX-INTERFACE.md). jcode fork runs inside sandboxes via `exec`.

## Engine trait (Rust)

```rust
#[async_trait]
pub trait Engine: Send + Sync {
    async fn create(&self, spec: SpawnSpec) -> Result<Sandbox, EngineError>;
    async fn exec(&self, id: &SandboxId, cmd: ExecCmd) -> Result<ExecHandle, EngineError>;
    async fn diff(&self, id: &SandboxId) -> Result<Diff, EngineError>;
    async fn snapshot(&self, id: &SandboxId) -> Result<SnapshotId, EngineError>;
    async fn restore(&self, id: &SandboxId, snap: &SnapshotId) -> Result<(), EngineError>;
    async fn kill(&self, id: &SandboxId) -> Result<(), EngineError>;
    async fn health(&self, id: &SandboxId) -> Result<Health, EngineError>;
    fn name(&self) -> &'static str;
}
```

Engine selection at startup: probe for bwrap → sandbox-exec → WSL2 → fallback. `ENGINE_UNAVAILABLE` if explicitly-requested engine is missing.

## Build order for the restructure

```
1. Fork the repo into ./shiro. Strip sync logic (compiles clean, no watcher).
2. Rename crates: relay→server, agent→engine(lib). Workspace builds.
3. Write fallback engine first (dir copy + spawn + git diff). No isolation.
4. Wire the REST contract (SANDBOX-INTERFACE.md) over the fallback engine.
5. Smoke test: spawn → exec echo → diff → kill, all over HTTP.
6. Linux engine (bwrap + cgroups + overlayfs). This is the real one.
7. macOS engine (sandbox-exec + APFS). Windows (WSL2).
8. Snapshots + health + usage tracking.
9. Security pass: path traversal, traversal-safe file API, limit enforcement.
```

Step 3-5 = the mock sandbox made real. The orchestrator can be built in parallel against this contract from step 4 onward.

## Security hard-requirement (unchanged)

Workers run untrusted model shell commands. Fallback engine is **dev-only**. Production on user machines requires bwrap / sandbox-exec / WSL2 minimum. If any engine turns out to be plain containers with shared kernel, we wrap with microsandbox — containers are not a security boundary.
