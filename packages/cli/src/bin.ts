/**
 * Unified entry point for both the local CLI (via bin/vp) and the global CLI (via Rust vp binary).
 *
 * Global commands (create, migrate, --version) are handled by rolldown-bundled modules.
 * All other commands are delegated to the Rust core through NAPI bindings.
 *
 * When called from the global CLI (detected via VITE_PLUS_CLI_BIN env var), this entry
 * point first tries to find the project's local vite-plus and delegates to it.
 * If not found, it falls back to the global installation's NAPI binding.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Parse command line arguments
let args = process.argv.slice(2);

// Transform `vp help [command]` into `vp [command] --help`
if (args[0] === 'help' && args[1]) {
  args = [args[1], '--help', ...args.slice(2)];
  process.argv = process.argv.slice(0, 2).concat(args);
}

const command = args[0];

// Global commands — handled by rolldown-bundled modules in dist/global/
if (command === 'create') {
  await import('./global/create.js');
} else if (command === 'migrate') {
  await import('./global/migrate.js');
} else if (command === '--version' || command === '-V') {
  await import('./global/version.js');
} else {
  // VITE_PLUS_CLI_BIN is set by the Rust vp binary when calling JS scripts.
  // If present, we're running from the global CLI and should try the local installation first.
  const isGlobalCli = !!process.env.VITE_PLUS_CLI_BIN;

  if (isGlobalCli) {
    const localPkgRoot = findLocalVitePlus(process.cwd());
    if (localPkgRoot) {
      // Delegate to the project's local vite-plus
      await import(pathToFileURL(join(localPkgRoot, 'dist', 'bin.js')).href);
    } else {
      // No local vite-plus — fall back to the global installation
      await runLocalCli();
    }
  } else {
    // Called directly via bin/vp (local npm installation) — use our own NAPI binding
    await runLocalCli();
  }
}

async function runLocalCli() {
  const { run } = await import('../binding/index.js');
  const { doc } = await import('./resolve-doc.js');
  const { fmt } = await import('./resolve-fmt.js');
  const { lint } = await import('./resolve-lint.js');
  const { pack } = await import('./resolve-pack.js');
  const { test } = await import('./resolve-test.js');
  const { resolveUniversalViteConfig } = await import('./resolve-vite-config.js');
  const { vite } = await import('./resolve-vite.js');

  run({
    lint,
    pack,
    fmt,
    vite,
    test,
    doc,
    resolveUniversalViteConfig,
    args: process.argv.slice(2),
  })
    .then((exitCode) => {
      process.exit(exitCode);
    })
    .catch((err) => {
      console.error('[Vite+] run error:', err);
      process.exit(1);
    });
}

/**
 * Find the project's local vite-plus package root directory.
 * Returns null if vite-plus is not installed in the project.
 */
function findLocalVitePlus(cwd: string): string | null {
  try {
    const require = createRequire(join(cwd, 'noop.js'));
    const pkgPath = require.resolve('vite-plus/package.json');
    return dirname(pkgPath);
  } catch {
    return null;
  }
}
