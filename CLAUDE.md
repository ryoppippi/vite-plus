# Vite-Plus

A monorepo task runner (like nx/turbo) with intelligent caching and dependency resolution, plus a unified CLI (`vp`) for building, testing, linting, and managing monorepo projects.

## Core Concept

**Task Execution**: Run tasks across monorepo packages with automatic dependency ordering.

```bash
# Built-in commands
vp build                           # Run Vite build (dedicated command)
vp test                            # Run Vitest (dedicated command)
vp lint                            # Run oxlint (dedicated command)

# Run tasks across packages (explicit mode)
vp run build -r                    # recursive with topological ordering
vp run app#build web#build         # specific packages
vp run build -r --no-topological   # recursive without implicit deps

# Run task in current package (implicit mode - for non-built-in tasks)
vp run dev                         # runs dev script from package.json
```

## Repository Layout

```
vite-plus/
├── crates/                  # Rust crates (core logic)
│   ├── vite_global_cli/     # Main `vp` binary — CLI entry point
│   ├── vite_command/        # Command execution and binary resolution
│   ├── vite_error/          # Error types (thiserror-based)
│   ├── vite_install/        # Package manager abstraction (npm/pnpm/yarn/bun)
│   ├── vite_js_runtime/     # Node.js runtime download & management
│   ├── vite_migration/      # Code migration and AST transformation
│   ├── vite_shared/         # Shared utilities (output, env, tracing)
│   └── vite_static_config/  # Static Vite config parsing (via oxc)
├── packages/                # TypeScript/Node.js packages
│   ├── cli/                 # Local CLI + NAPI Rust bindings (`vite-plus`)
│   ├── core/                # Core framework (Vite + Rolldown re-exports)
│   ├── test/                # Testing framework (Vitest-based)
│   ├── tools/               # Build-time tools (snap test runner, json-edit)
│   └── prompts/             # Interactive CLI prompts (@clack/core)
├── rolldown/                # Rolldown submodule (bundler core)
├── rolldown-vite/           # Rolldown + Vite integration submodule
├── ecosystem-ci/            # Integration tests for real-world projects
├── bench/                   # Rust benchmarks (criterion2)
├── docs/                    # VitePress documentation site
├── scripts/                 # Build/release scripts
└── rfcs/                    # Design proposals
```

## Key Architecture

### CLI Architecture (two layers)

1. **Global CLI** — Rust binary (`crates/vite_global_cli/`)
   - Entry point: `crates/vite_global_cli/src/main.rs`
   - CLI parsing: `crates/vite_global_cli/src/cli.rs` (clap-based)
   - Commands: `crates/vite_global_cli/src/commands/` (add, remove, update, env, migrate, etc.)
   - Shim system: `crates/vite_global_cli/src/shim/` (command interception/caching)
   - Manages Node.js runtime via `vite_js_runtime`

2. **Local CLI** — TypeScript + NAPI bindings (`packages/cli/`)
   - Entry point: `packages/cli/src/bin.ts`
   - NAPI binding: `packages/cli/binding/src/lib.rs` (Rust↔JS bridge via ThreadsafeFunction)
   - Execution core: `packages/cli/binding/src/exec/` (task execution from Rust side)
   - Command resolvers: `packages/cli/src/*.ts` (lint.ts, test.ts, vite.ts, fmt.ts, etc.)

### Task Execution (external crate)

The task graph and scheduling engine lives in a **separate repository** (`vite-task`), pulled in as a Git dependency:

- **`vite_task`** — Task graph building and execution
- **`vite_workspace`** — Workspace loading and package resolution
- **`vite_path`** — Type-safe path system (AbsolutePath/RelativePath)
- **`vite_str`** — Optimized string type
- **`vite_glob`** — Glob pattern matching
- **`fspy`** — File system access tracking

These are declared in `Cargo.toml` workspace dependencies. For local development against `vite-task`, uncomment the `[patch.crates-io]` section at the bottom of `Cargo.toml`.

## Task Dependencies

1. **Explicit** (always applied): Defined in `vite-task.json`

   ```json
   {
     "tasks": {
       "test": {
         "command": "jest",
         "dependsOn": ["build", "lint"]
       }
     }
   }
   ```

2. **Implicit** (when `--topological`): Based on package.json dependencies
   - If A depends on B, then A#build depends on B#build automatically

## Key Features

- **Topological Flag**: Controls implicit dependencies from package relationships
  - Default: ON for `--recursive`, OFF otherwise
  - Toggle with `--no-topological` to disable

- **Boolean Flags**: All support `--no-*` pattern for explicit disable
  - Example: `--recursive` vs `--no-recursive`
  - Conflicts handled by clap
  - If you want to add a new boolean flag, follow this pattern

## Rust Conventions

### Path Type System

- **Type Safety**: All paths use typed `vite_path` instead of `std::path` for better safety
  - **Absolute Paths**: `vite_path::AbsolutePath` / `AbsolutePathBuf`
  - **Relative Paths**: `vite_path::RelativePath` / `RelativePathBuf`

- **Usage Guidelines**:
  - Use methods such as `strip_prefix`/`join` provided in `vite_path` for path operations instead of converting to std paths
  - Only convert to std paths when interfacing with std library functions, and this should be implicit in most cases thanks to `AsRef<Path>` implementations
  - Add necessary methods in `vite_path` instead of falling back to std path types

- **Converting from std paths** (e.g., `TempDir::path()`):

  ```rust
  let temp_path = AbsolutePathBuf::new(temp_dir.path().to_path_buf()).unwrap();
  ```

- **Function signatures**: Prefer `&AbsolutePath` over `&std::path::Path`

- **Passing to std functions**: `AbsolutePath` implements `AsRef<Path>`, use `.as_path()` when explicit `&Path` is required

### Clippy Rules

All **new** Rust code must follow the custom clippy rules defined in `.clippy.toml` (disallowed types, macros, and methods). Existing code may not fully comply due to historical reasons.

**Disallowed types** (enforced by clippy):
- `std::path::Path` / `PathBuf` → use `vite_path::AbsolutePath` / `RelativePath`
- `std::collections::HashMap` / `HashSet` → use `rustc_hash::FxHashMap` / `FxHashSet`
- `std::string::String` → use `vite_str::Str` for small strings; `Box/Rc/Arc<str>` for large immutable strings

**Disallowed macros**:
- `println!` / `eprintln!` → use `vite_shared::output` functions
- `format!` → use `vite_str::format`

**Disallowed methods**:
- `str::to_lowercase()` and friends → use `cow_utils::CowUtils` equivalents
- `std::env::current_dir()` → use `vite_path::current_dir`

### Rust Toolchain

- **Nightly** (`nightly-2025-12-11`) — required for `Z-bindeps` (NAPI/fspy) and Windows process extensions
- **Edition**: 2024
- **MSRV**: 1.92.0

## CLI Output

All user-facing output must go through shared output modules instead of raw print calls.

- **Rust**: Use `vite_shared::output` functions (`info`, `warn`, `error`, `note`, `success`) — never raw `println!`/`eprintln!` (enforced by clippy `disallowed-macros`)
- **TypeScript**: Use `packages/cli/src/utils/terminal.ts` functions (`infoMsg`, `warnMsg`, `errorMsg`, `noteMsg`, `log`) — never raw `console.log`/`console.error`

## Build

- Run `pnpm bootstrap-cli` from the project root to build all packages and install the global CLI
  - This builds all `@voidzero-dev/*` and `vite-plus` packages
  - Compiles the Rust NAPI bindings and the `vp` Rust binary
  - Installs the CLI globally to `~/.vite-plus/`
- Run `pnpm build` to build only the TypeScript packages
- Run `cargo build -p vite_global_cli` to build only the Rust binary

## Tests

- Run `cargo test` to execute all Rust tests
- Run `cargo test -p <crate>` to test a specific crate (e.g., `cargo test -p vite_global_cli`)
- You never need to run `pnpm install` in the test fixtures dir, vite-plus should able to load and parse the workspace without `pnpm install`.

## Snap Tests

Snap tests are located in `packages/cli/snap-tests/` (local CLI) and `packages/cli/snap-tests-global/` (global CLI). Each test case is a directory containing:

- `package.json` - Package configuration for the test
- `steps.json` - Commands to run and environment variables
- `src/` - Source files for the test
- `snap.txt` - Expected output (generated/updated by running the test)

```bash
# Run all snap tests (local + global)
pnpm -F vite-plus snap-test

# Run only local CLI snap tests
pnpm -F vite-plus snap-test-local
pnpm -F vite-plus snap-test-local <name-filter>

# Run only global CLI snap tests
pnpm -F vite-plus snap-test-global
pnpm -F vite-plus snap-test-global <name-filter>
```

The snap test will automatically generate/update the `snap.txt` file with the command outputs. It exits with zero status even if there are output differences; you need to manually check the diffs(`git diff`) to verify correctness.

## Git Workflow

- Run `vp check --fix` before committing to format and lint code
- The `just ready` recipe runs all pre-commit quality checks: typos, fmt, check, test, lint, doc
- `lint-staged` runs `vp check --fix` on JS/TS/md/yaml files and `cargo fmt` on Rust files

## Quick Reference

- **Compound Commands**: `"build": "tsc && rollup"` splits into subtasks
- **Task Format**: `package#task` (e.g., `app#build`)
- **Path Types**: Use `vite_path` types instead of `std::path` types for type safety
- **Hash Maps**: Use `rustc_hash::FxHashMap` instead of `std::collections::HashMap`
- **Strings**: Use `vite_str::Str` for small strings, `vite_str::format` instead of `format!`
- **Tests**: Run `cargo test -p vite_global_cli` to verify CLI changes
- **Debug**: Use `--debug` to see cache operations
- **Node.js**: Requires `>=22.18.0` (managed runtime available via `vp env`)
- **Package Manager**: `pnpm@10.28.0`
