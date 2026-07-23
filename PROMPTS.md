# PROMPTS — the orchestrator's core IP

> The prompts ARE the product. The harness is plumbing; these decide whether splits are sensible, scopes are minimal, and couplings compile. Version every prompt. Change one = bump the version, re-run golden tests (TESTING.md).

## Conventions
- All prompts take a `PROJECT_SUMMARY` (~2K tokens: tree, stack, key files) + `OKF_CONTEXT` (top-N recalled lessons) + task-specific payload.
- All outputs are strict JSON. Parse failure = one automatic re-ask, then mark failed.
- Orchestrator model: Kimi K3 default. Fable 5 opt-in. Prompts are model-agnostic.

---

## 1. `planner.md` — task → features + waves

**Input:** PROJECT_SUMMARY, OKF_CONTEXT, USER_PROMPT
**Output:**
```json
{
  "features": [
    {
      "id": "auth",
      "description": "what to build, worker-facing, self-contained",
      "files": ["existing files the worker needs to READ"],
      "newFiles": ["files the worker will CREATE"],
      "dependencies": ["other feature ids this needs"]
    }
  ],
  "sharedFiles": ["files >1 feature edits"],
  "waves": [["auth","dashboard"],["payment"]]
}
```
**Rules the prompt must enforce:**
- `files` = MINIMAL read set. Never the whole repo. This is the cost lever.
- A feature is one coherent worker task: 5-50K output tokens. Too big = split again.
- `dependencies` only when a feature literally needs another's output (e.g. its model/type).
- `sharedFiles` flags coupling candidates up front.
- If the task isn't parallelizable, return ONE feature. Single-worker is fine.

## 2. `scoper.md` — feature → exact file set (optional second pass)
Used when the planner's file list is coarse. Given the repo tree + one feature, return the minimal file list. Only invoked when the planner says `files: "auto"`.

## 3. `worker.md` — the jcode system prompt (in-sandbox)
**Input:** TASK (feature.description), OKF_CONTEXT (lessons relevant to this slice), file scope
**Rules:**
- You have ONLY the mounted files. Do not invent files you can't see.
- Run the quality gate before exiting (lint/typecheck/test if present).
- Emit the structured result: `{ changedFiles, status, errors, summary }`.
- `summary` is ONE LINE for the orchestrator's judgment.

## 4. `judge.md` — worker output → pass/fail
**Input:** feature description, worker diff, quality-gate output, summary
**Output:** `{ "verdict": "pass|fail", "failureClass": "syntax|logic|scope|model", "reason": "...", "lesson": "what to tell the retry" }`
- `lesson` becomes the OKF doc seed on failure. Be specific: "approach X fails here because Y", not "try again".

## 5. `coupler.md` — N versions of one file → merged file
**Input:** original file + each worker's version + each worker's one-line intent
**Rules:**
- Preserve BOTH intents. If truly conflicting (same line, different logic), prefer the change that satisfies the earlier wave, flag the conflict.
- Output the full merged file + `{ "conflicts": [...] }`.
- Any conflict → escalate to K3 with conflict context.

## 6. `verifier-fix.md` — failing build → fix patch
**Input:** build/test error output + the coupled files
**Output:** patch or `{ "unfixable": true, "reason": "..." }` → escalates to K3.

## 7. `okf-writer.md` — run outcome → canonical OKF doc
**Input:** the full build trace (plan, verdicts, lessons, couplings, verification)
**Output:** OKF markdown + frontmatter: `{ problem_type, stack, scope: project|global, approach_worked, approach_failed, confidence }`
- Written by the ORCHESTRATOR (large model) — canonical truth. Workers never write OKF.
- Before writing: check cognee/store for near-duplicate (similarity > 0.9 → update, don't create).

## 8. `okf-recall.md` — task → relevant lessons
Worker-side. Embed task → top-N candidates → the worker judges which apply. No orchestrator involvement (keeps its tokens tiny).

## Versioning
```
prompts/
  planner.v1.md   coupler.v1.md   judge.v1.md ...
```
Every validation run records which prompt versions produced which results. Prompt changes ship like code: PR + golden tests.
