/**
 * VitePress tool resolver for the vite-plus CLI.
 *
 * This module exports a function that resolves the VitePress binary path
 * using Node.js module resolution. The resolved path is passed back
 * to the Rust core, which then executes VitePress for documentation.
 *
 * Used for: `vite-plus doc` command
 */

import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

/**
 * Resolves the VitePress binary path and environment variables.
 *
 * @returns Promise containing:
 *   - binPath: Absolute path to the VitePress CLI entry point
 *   - envs: Environment variables to set when executing VitePress
 *
 * VitePress is a Vite & Vue powered static site generator for
 * building documentation websites with excellent performance.
 */
export async function doc(): Promise<{
  binPath: string;
  envs: Record<string, string>;
}> {
  // Resolve the VitePress CLI module directly
  const binPath = require.resolve('vitepress/bin/vitepress.js', {
    paths: [process.cwd(), dirname(fileURLToPath(import.meta.url))],
  });

  return {
    binPath,
    // Pass through source map debugging environment variable if set
    envs: process.env.DEBUG_DISABLE_SOURCE_MAP
      ? {
        DEBUG_DISABLE_SOURCE_MAP: process.env.DEBUG_DISABLE_SOURCE_MAP,
      }
      : {},
  };
}