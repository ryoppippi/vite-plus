# vite-plus Performance Analysis

Performance measurements from E2E tests (Ubuntu, GitHub Actions runner).

**Test projects**: 9 ecosystem-ci projects (single-package and multi-package monorepos)
**Node.js**: 22-24 (managed by vite-plus js_runtime)
**Trace source**: E2E run #22552050124 (73 trace files across 9 projects)

## Architecture Overview

A `vp` command invocation traverses multiple layers:

```
User runs `vp run lint:check`
  |
  +- [1] Global CLI (Rust binary `vp`)                    ~3-9ms
  |     +- argv0 processing                                ~40us
  |     +- Node.js runtime resolution                       ~1.3ms
  |     +- Module resolution (oxc_resolver)                  ~170us
  |     +- Delegates to local CLI via exec(node bin.js)
  |
  +- [2] Node.js startup + NAPI loading                    ~3.7ms
  |     +- bin.ts entry -> import NAPI binding -> call run()
  |
  +- [3] Rust core via NAPI (vite-task session)
  |     +- Session init                                     ~60us
  |     +- load_package_graph (workspace discovery)          ~1-10ms
  |     +- load_user_config_file x N (JS callbacks)          ~168ms-1.3s total
  |     +- handle_command + resolve (JS callbacks)            ~0.02-1.3ms
  |     +- Task execution (spawns child processes)
  |
  +- [4] Task spawns (child processes)
        +- Spawn 1: pnpm install / dependsOn                ~0.95-1.05s
        +- Spawn 2: actual command                           varies (1-6s)
```

## Cross-Project Comparison

Overhead measured from all 9 ecosystem-ci projects (Ubuntu, first run):

| Project                   | Packages | Global CLI | load_package_graph | Config loading | Total overhead |
| ------------------------- | -------- | ---------- | ------------------ | -------------- | -------------- |
| oxlint-plugin-complexity  | 1        | 8.8ms      | 1.0ms              | **168ms**      | **170ms**      |
| vue-mini                  | 4        | 6.1ms      | 2.2ms              | **172ms**      | **175ms**      |
| dify                      | 1        | 4-14ms     | 10.0ms             | **181ms**      | **196ms**      |
| vitepress                 | 4        | 3.9ms      | 1.2ms              | **196ms**      | **199ms**      |
| vite-vue-vercel           | 1        | 3-7ms      | 1.4ms              | **360ms**      | **364ms**      |
| rollipop                  | 6        | 4-5ms      | 2.7ms              | **639ms**      | **648ms**      |
| frm-stack                 | 10-11    | 3-7ms      | 3.5ms              | **836ms**      | **843ms**      |
| tanstack-start-helloworld | 1        | 4-6ms      | 0.1ms              | **1,292ms**    | **1,294ms**    |
| vibe-dashboard            | N/A      | 4-7ms      | N/A                | N/A            | N/A            |

vibe-dashboard only produced global CLI traces (no NAPI traces captured).

Config loading accounts for **95-99%** of total NAPI overhead in every project. Everything else is negligible.

### Config Loading Patterns

The first `load_user_config_file` call always pays a fixed JS module initialization cost (~150-170ms for typical projects). Projects with heavy Vite plugins pay much more:

| Project                   | First config | Biggest config | Subsequent configs |
| ------------------------- | ------------ | -------------- | ------------------ |
| oxlint-plugin-complexity  | 168ms        | 168ms          | N/A (single)       |
| vue-mini                  | 164ms        | 164ms          | 2-3ms              |
| vitepress                 | 168ms        | 168ms          | 3-14ms             |
| dify                      | 181ms        | 181ms          | N/A (single)       |
| vite-vue-vercel           | 360ms        | 360ms          | N/A (single)       |
| rollipop                  | 155ms        | 155ms          | 100-147ms          |
| frm-stack                 | 148ms        | **660ms**      | 3-12ms             |
| tanstack-start-helloworld | **1,292ms**  | **1,292ms**    | N/A (single)       |

Key observations:

- **tanstack-start-helloworld** has the slowest single config load (1.3s) despite being a single-package project. This is entirely due to heavy TanStack/Vinxi plugin dependencies.
- **frm-stack** has one "monster" config at ~660ms (a specific workspace package with heavy plugins), accounting for ~77% of its total config loading time.
- **rollipop** is unusual: subsequent config loads remain expensive (100-147ms) rather than dropping to 2-12ms, suggesting each package imports distinct heavy dependencies.
- Simple projects (oxlint-plugin-complexity, vue-mini, vitepress) have a consistent ~165ms first-config cost, representing the baseline JS module initialization overhead.

## Phase 1: Global CLI (Rust binary)

Measured via Chrome tracing from the `vp` binary process.
Timestamps are relative to process start (microseconds).

### Breakdown (vibe-dashboard, 6 invocations, Ubuntu)

| Stage                     | Time from start | Duration   |
| ------------------------- | --------------- | ---------- |
| argv0 processing          | 37-57us         | ~40us      |
| Runtime resolution start  | 482-684us       | ~500us     |
| Node.js version selected  | 714-1042us      | ~300us     |
| LTS alias resolved        | 723-1075us      | ~10us      |
| Version index cache check | 1181-1541us     | ~400us     |
| Node.js version resolved  | 1237-1593us     | ~50us      |
| Node.js cache confirmed   | 1302-1627us     | ~50us      |
| **oxc_resolver start**    | **3058-7896us** | --         |
| oxc_resolver complete     | 3230-8072us     | **~170us** |
| Delegation to Node.js     | 3275-8160us     | ~40us      |

### Cross-Project Global CLI Overhead

| Project                   | Range      |
| ------------------------- | ---------- |
| vite-vue-vercel           | 3.4-6.9ms  |
| rollipop                  | 3.7-4.7ms  |
| tanstack-start-helloworld | 3.7-6.2ms  |
| vitepress                 | 3.9ms      |
| vibe-dashboard            | 4.1-6.7ms  |
| vue-mini                  | 6.1ms      |
| oxlint-plugin-complexity  | 8.8ms      |
| dify                      | 4.3-13.6ms |
| frm-stack                 | 3.4-7.4ms  |

Global CLI overhead is consistently **3-9ms** across all projects, with rare outliers up to 14ms. This is the Rust binary resolving Node.js version, finding the local vite-plus install via oxc_resolver, and delegating via exec.

## Phase 2: Node.js Startup + NAPI Loading

Measured from NAPI-side Chrome traces (frm-stack project).

The NAPI `run()` function is first called at **~3.7ms** from Node.js process start:

| Event                   | Time (us) | Notes                              |
| ----------------------- | --------- | ---------------------------------- |
| NAPI `run()` entered    | 3,682     | First trace event from NAPI module |
| `napi_run: start`       | 3,950     | After ThreadsafeFunction setup     |
| `cli::main` span begins | 4,116     | CLI argument processing starts     |

This means **Node.js startup + ES module loading + NAPI binding initialization takes ~3.7ms**.

## Phase 3: Rust Core via NAPI (vite-task)

### NAPI-side Detailed Breakdown (frm-stack `vp run lint:check`)

From Chrome trace, all times in us from process start:

```
  3,682   NAPI run() entered
  3,950   napi_run: start
  4,116   cli::main begins
  4,742   execute_vite_task_command begins
  4,865     session::init begins
  4,907       init_with begins
  4,923       init_with ends                              --  16us
  4,924     session::init ends                            --  59us
  4,925     session::main begins
  4,931       plan_from_cli_run_resolved begins
  4,935         plan_query begins
  4,941           load_task_graph begins
  4,943             task_graph::load begins
  4,944               load_package_graph begins           == 3.8ms
  8,764               load_package_graph ends
  8,779           load_user_config_file #1 begins         == 164ms (first vite.config.ts load)
173,248           load_user_config_file #1 ends
173,265           load_user_config_file #2 begins         == 12ms
185,212           load_user_config_file #2 ends
185,221           load_user_config_file #3 begins         == 3.4ms
188,666           load_user_config_file #3 ends
188,675           load_user_config_file #4 begins         == 741ms (cold import of workspace package config)
929,476           load_user_config_file #4 ends
  ...     (subsequent loads: ~3-5ms each)
```

### Critical Finding: vite.config.ts Loading is the Bottleneck

The **`load_user_config_file`** callback (which calls back into JavaScript to load `vite.config.ts` for each workspace package) dominates the task graph loading time:

| Config Load                     | Duration       | Notes                                                      |
| ------------------------------- | -------------- | ---------------------------------------------------------- |
| First package                   | **164ms**      | Cold import: requires JS module resolution + transpilation |
| Second package                  | **12ms**       | Warm: shared dependencies already cached                   |
| Third package                   | **3.4ms**      | Warm: nearly all deps cached                               |
| Fourth package (different deps) | **741ms**      | Cold: imports new heavy dependencies                       |
| Subsequent packages             | **3-5ms** each | All warm                                                   |

### frm-stack Per-Command Breakdown (10 traces, all values in ms)

| Command                          | Run   | CLI  | PkgGraph | 1st Cfg | Total Cfg | Cfg Count | Overhead | hdl_cmd |
| -------------------------------- | ----- | ---- | -------- | ------- | --------- | --------- | -------- | ------- |
| `lint:check`                     | 1st   | 6.46 | 3.20     | 146     | 889       | 10        | 901      | 0.02    |
| `lint:check`                     | cache | 5.06 | 3.34     | 145     | 840       | 11        | 845      | 0.02    |
| `format:check`                   | 1st   | 7.44 | 5.36     | 150     | 825       | 10        | 833      | 0.02    |
| `format:check`                   | cache | 3.58 | 3.44     | 148     | 829       | 11        | 834      | 0.00    |
| `typecheck`                      | 1st   | 3.64 | 3.20     | 153     | 831       | 10        | 837      | 0.02    |
| `typecheck`                      | cache | 4.41 | 3.35     | 144     | 816       | 11        | 821      | 0.00    |
| `@yourcompany/api#test`          | 1st   | 5.85 | 3.39     | 151     | 838       | 11        | 844      | 1.09    |
| `@yourcompany/api#test`          | cache | 4.29 | 2.91     | 145     | 835       | 11        | 842      | 1.17    |
| `@yourcompany/backend-core#test` | 1st   | 3.40 | 2.91     | 147     | 831       | 11        | 839      | 1.08    |
| `@yourcompany/backend-core#test` | cache | 3.90 | 3.35     | 145     | 824       | 11        | 831      | 1.16    |

### frm-stack Aggregate Statistics

| Metric                               | Average | n   |
| ------------------------------------ | ------- | --- |
| load_package_graph                   | 3.45ms  | 10  |
| Total config loading per command     | 835.9ms | 10  |
| First config load                    | 147.5ms | 10  |
| "Monster" config load (~config #4)   | ~660ms  | 10  |
| Other config loads                   | ~4.2ms  | ~87 |
| Total NAPI overhead                  | 842.7ms | 10  |
| Global CLI overhead                  | 4.80ms  | 10  |
| handle_command (non-test)            | 0.02ms  | 6   |
| handle_command (test w/ js_resolver) | 1.13ms  | 4   |

### First Run vs Cache Run (frm-stack averages)

| Metric               | First Run | Cache Run | Delta         |
| -------------------- | --------- | --------- | ------------- |
| Total NAPI overhead  | 850.7ms   | 834.7ms   | -16ms (-1.9%) |
| load_package_graph   | 3.6ms     | 3.3ms     | -0.3ms        |
| Total config loading | 843.0ms   | 828.8ms   | -14ms (-1.7%) |
| Global CLI overhead  | 5.4ms     | 4.2ms     | -1.1ms (-21%) |

Config loading is **not cached** between invocations -- it re-resolves all Vite configs from JavaScript every time. The ~16ms improvement on cache runs is from OS-level filesystem caching, not application-level caching.

### Callback Timing (`handle_command` + `resolve`)

After the task graph is loaded, vite-task calls back into JavaScript to resolve the tool binary:

```
937,757   handle_command begins
937,868     resolve begins
937,873       js_resolver begins (test command)
939,126       js_resolver ends                            -- 1.25ms
939,187     resolve ends
939,189   handle_command ends                             -- 1.43ms
```

The `js_resolver` callback (which locates the test runner binary via JavaScript) takes **~1.25ms**. Non-test commands (lint, fmt, typecheck) skip this callback and take only ~0.02ms.

## Phase 4: Task Execution (vibe-dashboard)

### Spawn Timing (First Run)

| Command        | Spawn 1 (setup)              | Spawn 2 (execution)           | Total |
| -------------- | ---------------------------- | ----------------------------- | ----- |
| `vp fmt`       | 1.05s (977 reads, 50 writes) | 1.00s (163 reads, 1 write)    | ~2.1s |
| `vp test`      | 0.96s (977 reads, 50 writes) | 5.71s (4699 reads, 26 writes) | ~6.7s |
| `vp run build` | 0.95s (977 reads, 50 writes) | 1.61s (3753 reads, 17 writes) | ~2.6s |

### Spawn Timing (Second Run -- Cache Available)

| Command        | Spawn 1 (setup)              | Spawn 2 (execution)          | Total | Delta     |
| -------------- | ---------------------------- | ---------------------------- | ----- | --------- |
| `vp fmt`       | 0.95s (977 reads, 50 writes) | 0.97s (167 reads, 3 writes)  | ~1.9s | -0.2s     |
| `vp test`      | 0.95s (977 reads, 50 writes) | 4.17s (1930 reads, 4 writes) | ~5.1s | **-1.6s** |
| `vp run build` | 0.96s (977 reads, 50 writes) | **cache hit (replayed)**     | ~1.0s | **-1.6s** |

### Key Observations

- **Spawn 1 is constant** (~0.95-1.05s, 977 path_reads, 50 path_writes) regardless of command or cache state. This is the workspace/task-graph loading + pnpm resolution overhead.
- **`vp run build` cache hit**: On second run, the build was fully replayed from cache, saving 1.19s. The 977-read spawn 1 still executes.
- **`vp test` improvement**: Second run read 1930 paths (vs 4699), suggesting OS filesystem caching reduced disk I/O.

## Phase 5: Task Cache Effectiveness

vite-task implements a file-system-aware task cache at `node_modules/.vite/task-cache`.

| Command        | First Run | Cache Run | Cache Hit? | Savings                           |
| -------------- | --------- | --------- | ---------- | --------------------------------- |
| `vp fmt`       | 2.1s      | 1.9s      | No         | --                                |
| `vp test`      | 6.7s      | 5.1s      | No         | -1.6s (OS cache)                  |
| `vp run build` | 2.6s      | 1.0s      | **Yes**    | **-1.6s** (1.19s from task cache) |

**Only `vp run build` was cache-eligible.** Formatting and test commands are not cached (side effects / non-deterministic outputs).

## End-to-End Timeline: Full Command Lifecycle

Combining all phases for a single `vp run lint:check` invocation (frm-stack):

```
T+0.00ms    Global CLI starts (Rust binary)
T+0.04ms    argv0 processed
T+0.50ms    Runtime resolution begins
T+1.30ms    Node.js version resolved (cached)
T+3.30ms    oxc_resolver finds local vite-plus              -- ~170us
T+3.35ms    exec(node, [dist/bin.js, "run", "lint:check"])   -- process replaced
--- Node.js process starts ---
T+3.70ms    NAPI run() called (Node.js startup overhead)
T+4.00ms    napi_run: start
T+4.12ms    cli::main begins
T+4.74ms    execute_vite_task_command begins
T+4.94ms    load_package_graph begins
T+8.76ms    load_package_graph ends                          -- 3.8ms
T+8.78ms    load_user_config_file #1 begins (JS callback)
T+173ms     load_user_config_file #1 ends                    -- 164ms * bottleneck
  ...       (more config loads, including one ~660ms monster)
T+937ms     handle_command begins
T+939ms     handle_command ends (js_resolver: 1.25ms)
T+940ms     Task execution starts (child process spawn)
  ...       (actual command runs)
```

**Total overhead before task execution: ~940ms**, of which **~930ms (99%) is vite.config.ts loading**.

## Wall-Clock Timelines (vibe-dashboard, Ubuntu)

### First Run

```
19:16:44.039  vp fmt    -- pnpm download starts
19:16:44.170  vp fmt    -- cache dir created
19:16:45.158  vp fmt    -- spawn 1 finished (setup)
19:16:46.028  vp fmt    -- spawn 2 finished (biome)           Total: ~2.0s
19:16:46.082  vp test   -- pnpm resolution starts
19:16:46.084  vp test   -- cache dir created
19:16:47.057  vp test   -- spawn 1 finished (setup)
19:16:52.750  vp test   -- spawn 2 finished (vitest)          Total: ~6.7s
19:16:52.846  vp run build -- cache dir created
19:16:53.793  vp run build -- spawn 1 finished (setup)
19:16:55.398  vp run build -- spawn 2 finished (vite build)   Total: ~2.6s
```

**Total first run: ~11.4s** (3 commands sequential)

### Cache Run

```
19:16:56.446  vp fmt    -- cache dir created
19:16:57.399  vp fmt    -- spawn 1 finished
19:16:58.368  vp fmt    -- spawn 2 finished                   Total: ~1.9s
19:16:58.441  vp test   -- cache dir created
19:16:59.390  vp test   -- spawn 1 finished
19:17:03.556  vp test   -- spawn 2 finished                   Total: ~5.1s
19:17:03.641  vp run build -- cache dir created
19:17:04.596  vp run build -- spawn 1 finished
19:17:05.040  vp run build -- cache replayed                  Total: ~1.4s
```

**Total cache run: ~8.6s** (-24% from first run)

## Summary of Bottlenecks

| Bottleneck                    | Time                       | % of overhead | Optimization opportunity                             |
| ----------------------------- | -------------------------- | ------------- | ---------------------------------------------------- |
| vite.config.ts loading (cold) | **168ms-1.3s** per project | **95-99%**    | Cache config results, lazy loading, parallel loading |
| Spawn 1 (pnpm/setup)          | **~1s**                    | --            | Persistent process, avoid re-resolving               |
| load_package_graph            | **0.1-10ms**               | <1%           | Already fast                                         |
| Session init                  | **~60us**                  | <0.01%        | Already fast                                         |
| Global CLI overhead           | **3-9ms**                  | <0.5%         | Already fast                                         |
| Node.js + NAPI startup        | **~3.7ms**                 | <0.4%         | Already fast                                         |
| oxc_resolver                  | **~170us**                 | <0.02%        | Already fast                                         |
| js_resolver callback          | **~1.25ms**                | <0.1%         | Already fast                                         |

**The single most impactful optimization would be caching or parallelizing `load_user_config_file` calls.** Across all projects:

- Simple configs (vue-mini, vitepress): ~168ms baseline, nearly all from first-config JS initialization
- Heavy single configs (tanstack-start-helloworld): up to 1.3s for a single config with heavy plugins
- Large monorepos (frm-stack, 10 packages): ~836ms total, dominated by one "monster" config (~660ms)
- Distinct-dependency monorepos (rollipop, 6 packages): ~639ms, each package importing different heavy dependencies (100-155ms each)

Config loading is not cached between `vp` invocations. Every command re-resolves all configs from JavaScript.

## Inter-Process Communication

vite-task uses Unix shared memory (`/dev/shm`) for parent-child process communication during task execution:

- Creates persistent mapping at `/shmem_<hash>`
- Maps memory into address space for fast IPC
- Cleaned up after spawn completion

## Known Issues

### Trace files break formatter (fixed)

When `VITE_LOG_OUTPUT=chrome-json` is set, trace files (`trace-*.json`) were written to the project working directory. Formatters (oxfmt/prettier) pick up these files and fail with "Unterminated string constant" because trace files may contain truncated JSON (especially on Windows where PATH strings are very long).

**Fix**: Set `VITE_LOG_OUTPUT_DIR` to write trace files to a dedicated directory outside the workspace.

### NAPI trace files empty for some projects

The Chrome tracing `FlushGuard` stored in a static `OnceLock` is never dropped when `process.exit()` is called. Fixed by adding `shutdownTracing()` NAPI function called before exit (commit `72b23304`). Some projects (vibe-dashboard) still only produce global CLI traces and no NAPI traces.

## Methodology

- **Tracing**: Rust `tracing` crate with `tracing-chrome` subscriber (Chrome DevTools JSON format)
- **Environment variables**: `VITE_LOG=debug`, `VITE_LOG_OUTPUT=chrome-json`, `VITE_LOG_OUTPUT_DIR=<dir>`
- **CI environment**: GitHub Actions ubuntu-latest runner
- **Measurement PRs**:
  - vite-task: https://github.com/voidzero-dev/vite-task/pull/178
  - vite-plus: https://github.com/voidzero-dev/vite-plus/pull/663
- **Trace sources**: 73 trace files across 9 projects (E2E run #22552050124)
  - frm-stack: 20 files (10 global CLI + 10 NAPI)
  - vibe-dashboard: 8 files (6 global CLI + 2 empty)
  - rollipop: 8 files (4 global CLI + 4 NAPI)
  - tanstack-start-helloworld: 10 files (4 global CLI + 4 NAPI + 2 empty)
  - vite-vue-vercel: 10 files (4 global CLI + 4 NAPI + 2 empty)
  - dify: 10 files (4 global CLI + 4 NAPI + 1 empty + 1 corrupted)
  - oxlint-plugin-complexity: 2 files (1 global CLI + 1 NAPI)
  - vitepress: 3 files (1 global CLI + 1 NAPI + 1 empty)
  - vue-mini: 2 files (1 global CLI + 1 NAPI)
