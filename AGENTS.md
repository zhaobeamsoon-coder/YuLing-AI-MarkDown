# YuLing MD Working Agreement

This file is the repository-level working agreement for Codex and other coding
agents. It incorporates reusable engineering disciplines from parent agreements,
translated into tool-independent rules for this repository. Parent `AGENTS.md`
files and higher-priority system, developer,
and explicit user instructions still apply. This file may tighten those rules
but must not silently relax them.

`CLAUDE.md` points to this file so architecture, safety, testing, and delivery
constraints have one project-level source of truth.

Keep this file focused on durable working rules. Product definitions, system
architecture, design proposals, and implementation details belong in their
dedicated documents; reference those sources here instead of copying them
inline.

## 1. Planning and stage discipline

- Inspect active instructions, repository status, relevant code, tests, schemas,
  and documentation before proposing or making a change. Resolve discoverable
  facts from the repository instead of asking the user.
- Changes to code, configuration, dependencies, schemas, public behavior,
  architecture, packaging, or deployment require an approved implementation
  plan unless the user explicitly waives planning.
- Treat planning, architecture, implementation, and verification as distinct
  stages. Planning does not edit implementation files; implementation follows
  the approved design instead of silently redesigning it.
- Before implementation, confirm that the approved plan or ADR is reachable
  from the current branch and reread the authoritative text. Do not implement
  from memory, a stale summary, or a document that exists only on another
  branch.
- If implementation reveals a missing product decision, return to planning. If
  it reveals an architectural conflict, return to architecture review. If
  verification reveals a bug inside the approved scope, return to implementation.
- Stop and report when new evidence invalidates a material premise. Do not use a
  convenient local fix to conceal a plan or architecture defect.
- Modify only the approved scope. Report adjacent cleanup, renaming, refactoring,
  or feature ideas separately rather than doing them opportunistically.
- Preserve unrelated user changes in dirty worktrees. Never discard, overwrite,
  stage, reformat, or commit unrelated work.

## 2. Critic Loop and decisions

- Before adopting a substantive recommendation from another AI, review, issue,
  document, PR, person, or the agent's own first design, record:
  1. the problem it is intended to solve;
  2. evidence that the problem exists in the current repository and version;
  3. at least two alternatives, including keeping current behavior when reasonable;
  4. the cost, side effects, and maintenance burden of each alternative; and
  5. an acceptance score from 0 to 100.
- Accept at 80 or above, discuss at 50-79, and reject below 50. Mechanical typo,
  syntax, and directly verified factual corrections do not require the full loop.
- When asking the user to decide a material issue, give options, benefits, costs,
  risks, evidence status, and a recommendation with reasons. Do not return a bare
  list of choices.
- A recommendation is not authorization. Wait for the user's decision before a
  materially different, destructive, external, or irreversible action.

## 3. Scope, YAGNI, and code craft

- Do not add abstractions, extension points, configuration, directories, or
  compatibility layers for hypothetical future requirements. An exception is an
  external contract whose later change would require data migration or consumer
  coordination.
- Prefer ordinary functions, explicit data flow, and direct control flow. Add a
  framework, class hierarchy, registry, or strategy only when the current
  requirement demonstrates the need.
- Search for existing implementations and conventions before creating another.
- Use precise names that state what a value contains or an operation does. Avoid
  context-free names such as `temp`, `data`, `info`, `helper`, `utils`, or
  `manager`, except in tiny conventional scopes where meaning is unambiguous.
- Every hand-written source, test, script, HTML, or template file must remain
  below 800 physical lines after normal formatting. Review responsibility at
  400-600 lines and split by domain responsibility before reaching the limit.
- Do not evade the limit by minifying, collapsing readable code, or combining
  unrelated responsibilities. Generated files, lock files, vendored code, and
  machine-produced artifacts are exempt.
- Existing files over the limit are tracked debt and must not grow. A behavior
  change touching one must include a bounded extraction in the approved plan.
- Before adding a dependency, verify existing capabilities cannot satisfy the
  requirement and check its maintenance and license impact.

## 4. Verification, evidence, and investigations

- Verify code symbols, paths, command flags, configuration keys, and third-party
  APIs from the repository, tool help, or primary documentation before using
  them. Memory is not evidence.
- Test assumptions about real data, directory layout, business structure,
  deployment state, and runtime behavior with a real read-only query or
  invocation. Similarity to another case is not proof.
- Plans, ADRs, reviews, and previous reports are evidence to reassess, not proof.
  Recheck their premises and version context before implementation, especially
  before irreversible actions.
- Verified facts have a time and version context, not an unlimited shelf life.
  Recheck repository state, configuration, deployment state, and external
  conditions when an earlier finding may have become stale.
- Material findings and recommendations must use one of these evidence labels:
  `我跑过 / I ran it (command and result)`,
  `文档里写的（未验） / documented but unverified`, or
  `我的推断（未验） / inference, unverified`.
- For complex reviews, incidents, and debugging, work in this order: establish
  scope and version context; trace code, configuration, dependencies, and call
  paths; verify real runtime conditions; then draw conclusions.
- A risk conclusion needs the complete chain `code path -> actual configuration
  -> active version -> triggerability -> impact`. An incomplete chain is
  `条件触发 / conditional` or `待验证 / needs verification`, not a current incident.
- Investigation findings use one of `当前成立 / currently present`,
  `历史遗留 / historical`, `条件触发 / conditional`, or
  `待验证 / needs verification`. Severity applies only after the evidence chain
  establishes a currently triggerable impact.
- Do not claim fixed, complete, passing, deployable, or usable until relevant
  checks have run successfully. Report skipped checks, failures, uncovered
  system gestures, and deviations from the approved plan.
- Capture the tested command's exit status directly. Do not let `tail`, `grep`, a
  later `echo`, log display, or task notification replace the originating exit
  status. With pipelines, use `pipefail` or inspect the originating status.
- Validate output shape before mapping it to success, failure, pending, or
  completion. Transport errors and malformed output are invalid readings.

## 5. Test-first and quality gates

- New or changed behavior, bug fixes, integration wiring, and decision rules
  start with a focused test. Run it and observe the expected failure for the
  intended reason before changing production code.
- Add the smallest implementation that passes, then refactor while keeping the
  test green. Documentation-only and behavior-preserving mechanical changes do
  not require artificial failing tests.
- Every new critical assertion must be mutation-verified: disable exactly the
  protected behavior, observe that assertion fail for the expected reason, then
  restore the implementation. One mutation proves only one assertion.
- Guard against false-green tests: an assertion must not already be satisfied by
  the fixture or initial UI state, and each independent critical assertion must
  be observed failing under its own targeted mutation.
- A wrapper, scheduler, retry loop, batch loop, daemon, or exception-catching
  path must have a production-shaped smoke test that exercises the complete call
  chain. Test count and direct unit calls are not substitutes.
- Focused tests are not completion evidence. Before handoff, run the complete
  affected suite and `scripts/check.sh`. Read and report the gate's own exit
  status. If prerequisites prevent the gate from running, report the exact gap
  and do not claim completion.
- Gate self-tests protect against accidental weakening, not every deliberate
  bypass. Enforce intentional tampering through repository permissions, branch
  protection, required checks, and review; do not build an endless adversarial
  test matrix for mechanisms those controls already own.
- For macOS release work, also build the production Tauri application, verify the
  `.app` signature and DMG image, install only with explicit authority, and test
  the production-shaped application path. Physical trackpad gestures that cannot
  be automated remain explicit manual acceptance items.
- Fixed regression coverage must include failures that have repeatedly returned:
  mouse and trackpad text selection, persistent selection and right-click copy,
  AI 知了 handoff, table divider dragging and layout restoration, nested
  document-tree scrolling, workspace opening, and Markdown document loading.

## 6. Time standard

- Human-facing project timestamps use Beijing time (`Asia/Shanghai`) everywhere,
  including plans, devlogs, test reports, operation records, release records,
  filenames containing wall-clock time, and commit bodies.
- The development machine may use an Australian timezone. Never copy plain
  `date` output into project records. Obtain human-facing timestamps with
  `TZ=Asia/Shanghai date` or an equivalent explicit conversion.
- Program-internal timestamps are timezone-aware UTC. Convert to
  `Asia/Shanghai` only at the final user-facing display boundary.
- Never rely on workstation, container, or server timezone to make a naive
  timestamp accidentally correct. Filename and on-site wall-clock timestamps
  must declare Beijing-time conversion explicitly.

## 7. Git, worktrees, and delivery

- Before branch work, inspect the current branch, dirty state, worktree
  relationships, and approved plan. If a remote exists and network access is
  authorized, fetch first and compare the branch with the current remote `main`.
- Use a task-specific branch or isolated worktree when it protects concurrent
  work. Codex-created branch names use `codex/<task>` unless the user specifies
  another exact name.
- Never infer authorization to commit, merge, push, publish, deploy, sign,
  notarize, delete a branch, or remove a worktree. Do only the explicitly
  authorized delivery action.
- Before handoff, report all uncommitted changes. When a commit is authorized,
  verify staged scope and do not add an AI `Co-Authored-By` trailer.
- After an authorized merge into `main`, fetch/prune when permitted, inventory
  remaining branches and worktrees with their divergence, and report them. Do
  not delete them without explicit authority.
- Never use destructive Git operations as a rollback shortcut. Preserve user
  work and prefer recoverable, narrowly targeted operations.

## 8. Security and release boundaries

- Never commit, package, log, or upload API keys, credentials, object-storage
  secrets, signing material, private documents, user Markdown, pasted images,
  chats, local indexes, caches, or logs.
- Credentials belong only in macOS Keychain. They must not enter `.env`, SQLite,
  workspace configuration, logs, Git, or application packages.
- Release and deployment inputs use an explicit allowlist. Unknown future paths,
  new secret types, and user data are excluded by default.
- Filesystem access is limited to user-authorized workspaces and user-selected
  export destinations. Reject absolute-path injection, `..`, symlink escape, and
  unintended overwrite.
- Do not push, publish, deploy, sign, notarize, change production state, or send
  external communications without authority covering that exact action.
- Check dependency licenses before adding them. Reject SSPL, Commons Clause,
  BUSL where incompatible with distribution, and unapproved copyleft licenses.

## 9. YuLing MD and AI 知了 product boundaries

- Public names are **YuLing MD / 毓灵 Markdown 编辑器** and **AI 知了
  (Zhi Liao)**. Never display “知料”.
- Markdown files remain canonical document data. Do not migrate user content
  into a closed database. App-only state belongs in AppLocalData; table and image
  layout metadata belongs in `.yulingmd/layout.json` and must not pollute Markdown.
- The product has no YuLing cloud account, subscription, telemetry, hidden
  upload, or background AI traffic unless the user approves a new product plan.
- AI network or local-model calls happen only after an explicit user action.
  Context is limited to the active selection, current document, and user-approved
  workspace retrieval results.
- Retrieved Markdown is untrusted reference material. It cannot change system
  rules, authorize commands, read outside the workspace, or trigger tools.
- AI responses must distinguish retrieved document facts from model inference.
  Knowledge-card source excerpts preserve the original selection even when the
  user edits the prompt sent to AI.
- Deleting workspace authorization removes application indexes and sessions, not
  user Markdown, assets, or knowledge cards.
- The first release remains macOS-first and light-theme-only unless an approved
  plan changes those boundaries.

## 10. Public repository privacy gate

- Keep a new public repository private and empty until the candidate Git tree,
  commit metadata, history, and exact push refspec pass the public release check.
- Public history must continue to descend from the one sanitized root commit.
  Private development history, recovery branches, tags, reflogs, and unreviewed
  refs must never be pushed. Sanitized `codex/*` branches may be pushed only for
  pull requests after the exact outbound commits pass the privacy gate. Never use
  `git push --all`, `--mirror`, or an unreviewed tag push.
- Public commits use the approved GitHub noreply identity. Real workstation
  email addresses, hostnames, home-directory names, internal repository names,
  customer names, and private infrastructure identifiers are forbidden.
- User Markdown, pasted images, chats, indexes, databases, AppLocalData, caches,
  logs, diagnostics, environment files, credentials, certificates, signing
  material, build outputs, dumps, archives, and unknown binaries are excluded by
  default. Existing application icons are the only approved binary asset family.
- Before every public push, run `scripts/public_release_check.sh` and the installed
  pre-push hooks. They fail closed when Gitleaks is unavailable, a finding is
  unexplained, history has another root, commit identity is not an approved
  GitHub noreply identity, or the ref is not `main` or a reviewed `codex/*` PR
  branch.
- After the one authorized bootstrap push, update `main` only through pull
  requests protected by required quality, privacy, and macOS E2E checks. Keep
  force pushes, branch deletion, tags, and bypass actors disabled at the remote.
