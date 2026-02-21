import { defineConfig } from 'rolldown';

export default defineConfig({
  input: './src/global-entry.ts',
  treeshake: false,
  external(source) {
    if (source.startsWith('node:')) {
      return true;
    }
    if (source === 'cross-spawn' || source === 'picocolors') {
      return true;
    }
    if (source.includes('binding/index')) {
      return true;
    }
    return false;
  },
  output: {
    format: 'esm',
    dir: './dist',
    entryFileNames: 'global-entry.js',
    chunkFileNames: 'global-[name].js',
  },
});
