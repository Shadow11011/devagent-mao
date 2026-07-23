# BUILD — DevAgent MAO, the whole build as it stands

> One engine. Two surfaces. Three layers. This is the reference we build against.
> Read [VALIDATION.md](VALIDATION.md) first — Phase 1 gates everything below.

---

## The Three Layers

```
┌─────────────────────────────────────────────────────────┐
│  MAO (the brain)                                        │
│  Plans. Routes. Couples. Verifies. Remembers.           │
│  Rust or Node. Talks to Shiro over HTTP.                │
├─────────────────────────────────────────────────────────┤
│  Shiro (the hands)                                      │
│  Spawns sandboxes. Isolates workers. Kills. Snapshots.  │
│  Node.js service. 4 engines. Local on the user's box.   │
├─────────────────────────────────────────────────────────┤
│  jcode fork (the fingers)                               │
│  Reads files. Writes code. Runs commands. Exits.        │
│  Rust binary. Swarm/server/memory stripped.             │
└─────────────────────────────────────────────────────────┘
```

MAO thinks. Shiro isolates. jcode builds.

---

## What happens when a user builds

```
"Add user authentication, a dashboard, and payment processing."

STEP 1 — PROJECT UNDERSTANDING
  MAO scans the project (package.json, tree, key files).
  Checks OKF memory: "built on this project before?"
  Builds a project summary (~2K tokens).

STEP 2 — PLANNING (Kimi K3 — expensive, smart)
  MAO sends summary + prompt + OKF context → K3.
  K3 returns:
  {
    "features": [
      { "id": "auth",      "files": ["src/app.ts","src/models/user.ts"],
        "newFiles": ["src/routes/auth.ts","src/middleware/auth.ts"],
        "dependencies": [] },
      { "id": "dashboard", "files": ["src/app.ts","src/models/post.ts"],
        "newFiles": ["src/routes/dashboard.ts"], "dependencies": [] },
      { "id": "payment",   "files": ["src/app.ts","src/models/order.ts"],
        "newFiles": ["src/routes/payment.ts"],   "dependencies": ["auth"] }
    ],
    "sharedFiles": ["src/app.ts"],
    "waves": [ ["auth","dashboard"], ["payment"] ]
  }
  Wave 1 = parallel (no deps). Wave 2 = after auth lands.

STEP 3 — SANDBOX CREATION (Shiro)
  Per wave-1 feature: overlayfs/APFS clone of the project,
  git init + baseline commit, resource limits (2GB RAM, 2 CPUs, 256 PIDs),
  OS-appropriate isolation. Reports "N sandboxes ready."

STEP 4 — WORKER EXECUTION (jcode fork, V4 Flash/Pro — cheap)
  Shiro spawns one jcode per sandbox:
    jcode --task "Build JWT auth..." --model v4-flash \
          --workdir /sandbox/auth --okf-context "prefers bcrypt..."
  jcode reads, writes, runs, exits with structured JSON:
    { changedFiles, diff, status, errors, tokens }
  Workers run in parallel. Live output streams to the UI.

STEP 5 — OUTPUT COLLECTION (Shiro)
  git diff per sandbox → { new, edited } + status + tokens + duration.
  Reports "Wave 1 complete. 2/2 succeeded."

STEP 6 — COUPLING (V4 Flash — cheap)
  Non-overlapping files copy directly. Overlapping files (app.ts
  edited by both) go to V4 Flash:
    "original + auth's version + dashboard's version → combine."
  ~3s, ~$0.001. Escalates to K3 on coupling failure.

STEP 7 — WAVE 2 (dependencies)
  "payment" sandbox is built FROM the coupled output (auth's
  User model is already there). Build → collect → couple.

STEP 8 — VERIFICATION (shell — free)
  Apply changes to a git branch: mao/build-<date>-<name>.
  Run install + build + tests.
  Pass → done. Fail → V4 Flash fix. Fail again → K3 fix.
  Fail again → show user the failure, keep the branch.

STEP 9 — MEMORY (OKF)
  Extract lessons: "Express + JWT + bcrypt", "app.ts is the
  shared entry point", "payment depends on auth's User model".
  Store structured lesson + embedding, project-scoped.

STEP 10 — RESULT
  ✅ 3 features · 7 files changed · 1m45s · $1.38
  (Fable 5 equivalent: $22.95 · saved 94%)
  [View changes] [Merge] [Undo] [Run again]
```

---

## Components

### MAO (the brain)
| Component | Job | Made of |
|-----------|-----|---------|
| **Planner** | prompt → features + files + waves | K3 call + [PROMPTS.md](PROMPTS.md) |
| **Coordinator** | spawn → monitor → waves → timeouts | Rust/Node, HTTP to Shiro |
| **Coupler** | overlapping outputs → coherent code | V4 Flash call, K3 escalation |
| **Verifier** | build + test the coupled output | shell, no tokens |
| **Cost router** | plan calls → K3, work calls → V4 | local proxy, inspect + route |
| **OKF memory** | extract, store, recall, consolidate | embeddings + local store |
| **Project scanner** | tree + stack → summary | fs reads + heuristics |

### Shiro (the hands)
| Component | Job |
|-----------|-----|
| **Sandbox runtime** | unified API: create, run, setLimits, snapshot, diff, kill, destroy |
| **Linux engine** | bwrap namespaces + cgroups v2 + overlayfs |
| **macOS engine** | sandbox-exec + APFS clones + watchdog |
| **Windows engine** | WSL2 → delegate to Linux engine; fallback = dir mode |
| **Fallback engine** | directory copy + child process + git tracking |
| **Terminal service** | PTY attach, WebSocket stream to UI |
| **File service** | read/write/list/diff with traversal protection |
| **Snapshot service** | overlayFS upper / APFS clone / git commit |
| **Session service** | create → run → monitor → kill → destroy state machine |
| **Usage tracker** | tokens, time, cost per sandbox per build |

### jcode fork (the fingers)
| Component | Status |
|-----------|--------|
| Rust binary (27.8MB RAM, 14ms boot) | kept |
| Tool system (file/terminal/browser) | kept |
| Skills system (lazy semantic load) | kept |
| CLI interface (--task --model --workdir) | kept, modified |
| TUI / rendering | kept |
| Self-dev mode | kept |
| Structured JSON output | **added** |
| OKF bridge (context in, lessons out) | **added — replaces jcode memory** |
| Sandbox awareness | **added** |
| Swarm (`jcode-swarm-core`) | **removed** |
| Server | **removed** |
| Memory system | **removed → OKF** |
| Inter-agent messaging | **removed** |

### Sandbox engines
| | Linux (bwrap) | macOS | Windows (WSL2) | Fallback |
|---|---|---|---|---|
| Files | overlayfs CoW | APFS clone | overlayfs via WSL2 | dir copy |
| Process | PID ns | sandbox-exec | PID ns via WSL2 | none |
| Network | net ns | sandbox-exec HTTPS-only | net ns via WSL2 | none |
| Limits | cgroups v2 | watchdog+rlimit | cgroups via WSL2 | optional watchdog |
| Snapshots | overlay upper | APFS clone | overlay via WSL2 | git commit |
| Security | seccomp+AppArmor | TrustedBSD MAC | seccomp via WSL2 | file perms |
| Startup | ~50ms | ~10ms | ~50ms | ~200ms |
| RAM/worker | ~12MB | ~8MB | ~12MB | ~5MB |

⚠️ **Security hard-requirement:** workers run untrusted model shell commands. The fallback engine is dev-only. Production workers on user machines need bwrap/sandbox-exec/WSL2 minimum. Verify Shiro's isolation model before launch.

---

## Error taxonomy (recovery is per-class, not blanket retry)

| Failure | Example | Recovery |
|---------|---------|----------|
| Syntax/compile | missing import | in-sandbox quality gate, no retry count |
| Logic | wrong algorithm | re-spin fresh + OKF lesson (max 3) |
| Scope | wrong files mounted | orchestrator re-scopes, fresh sandbox |
| Model | hallucinated API | escalate model immediately |
| Coupling | conflicting edits | K3 couples with conflict context |
| Infra | sandbox crashed | auto-restart, no retry penalty |

## Concurrency & resources
- Concurrency = user-configured, but the coordinator auto-suggests a cap from free RAM (5 sandboxes × ~28MB jcode + context ≈ safe at 8GB+).
- Wave queue: 5 features, 3 slots → FIFO by dependency order.
- API rate limiting: respect provider RPM/TPM; serialize on 429.
- Graceful degradation: OOM risk → serialize builds, don't crash.

---

## Repo structure (target)

```
devagent-mao/
├── README.md  DESIGN.md  HARNESS-SPEC.md  RESEARCH.md
├── BUILD.md  VALIDATION.md  SANDBOX-INTERFACE.md
├── PROMPTS.md  TESTING.md  MOAT.md
├── mao/                    ← orchestrator (Rust/Node)
│   ├── src/ planner.ts  coordinator.ts  coupler.ts
│   │      verifier.ts  costRouter.ts  projectScanner.ts
│   │      shiroClient.ts
│   └── prompts/ planner.md  coupler.md  verifier.md
├── shiro/                  ← sandbox engine (Node, friend's codebase)
│   ├── src/ runtime/ (engines: linux, macos, windows, fallback)
│   │      services/ (terminal, files, sessions, snapshots, usage)
│   │      routes/ (sandbox, terminal, files, orchestration)
│   └── prisma/ schema.prisma
├── okf/                    ← memory (store, recall, extract, consolidate)
├── agent/                  ← jcode fork (Rust, stripped)
├── ui/                     ← React frontend
├── desktop/                ← Tauri shell (bundles shiro + mao + agent)
└── infra/                  ← hosted tier (later)
```

## What exists vs what's designed

| Component | Status |
|-----------|--------|
| Shiro codebase (Express, React, Prisma, Socket.IO, xterm.js) | exists (friend's repo) — MIT/licensing TBD |
| jcode (Rust agent) | exists externally — fork not started |
| Architecture decisions | done, locked |
| Sandbox engine (4 engines) | designed, not built |
| MAO orchestrator | designed, not built |
| OKF memory | designed, not built |
| Coupling approach | designed, **not validated** — see VALIDATION.md |
| Planner prompt | **not written** — core IP |
| Frontend additions | designed, not built |
| Tauri shell | designed, not built |
| Tests | zero — see TESTING.md |
| Hosted tier | configs only |

---

## Build order

```
PHASE 1 — VALIDATE (gates everything)
  Fork jcode, strip swarm/server/memory → standalone worker.
  Run VALIDATION.md protocol. Kill if merge success < 70%.

PHASE 2 — MVP
  Fallback engine → integrate stripped jcode → coordinator
  (spawn → wait → collect → couple → verify) → cost router →
  first end-to-end build.

PHASE 3 — ISOLATION
  Linux/macOS/Windows engines. Security fixes.

PHASE 4 — MEMORY
  OKF store/recall/extract/consolidate. Wire into jcode + planner.

PHASE 5 — PRODUCT
  Build view, terminal, file browser, coupling review, OKF browser,
  cost tracker, settings. Tauri shell. First-launch wizard.

PHASE 6 — HARDEN
  Tests, CI, observability (tracing, span IDs per sandbox), edge cases.

PHASE 7 — LAUNCH
  MIT release. README, docs, demo. HN/Reddit.

PHASE 8 — HOSTED TIER
  Multi-tenant Shiro, Stripe, team OKF, enterprise.
```
