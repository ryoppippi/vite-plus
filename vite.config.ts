import { defineConfig } from 'vite-plus';

export default defineConfig({
  lint: {
    plugins: ['unicorn', 'typescript', 'oxc'],
    categories: {
      correctness: 'error',
      perf: 'error',
      suspicious: 'error',
    },
    rules: {
      'eslint-plugin-unicorn/prefer-array-find': 'off',
      'eslint/no-await-in-loop': 'off',
      'eslint/no-new': 'off',
      'no-console': ['error', { allow: ['error'] }],
      'oxc/no-accumulating-spread': 'off',
      'oxc/no-async-endpoint-handlers': 'off',
      'oxc/no-map-spread': 'off',
      'typescript/no-explicit-any': 'error',
      'typescript/no-extraneous-class': 'off',
      'typescript/no-unsafe-type-assertion': 'off',
      'unicorn/consistent-function-scoping': 'off',
      'unicorn/require-post-message-target-origin': 'off',
      curly: 'error',
    },
    overrides: [
      {
        files: [
          '.github/**/*',
          'bench/**/*.ts',
          'ecosystem-ci/**/*',
          'packages/*/build.ts',
          'packages/core/rollupLicensePlugin.ts',
          'packages/core/vite-rolldown.config.ts',
          'packages/tools/**/*.ts',
        ],
        rules: {
          'no-console': 'off',
        },
      },
      {
        files: ['packages/cli/src/oxlint-config.ts'],
        rules: {
          'typescript/no-explicit-any': 'off',
        },
      },
    ],
    ignorePatterns: ['**/snap-tests/**', '**/snap-tests-todo/**'],
  },
  test: {
    exclude: [
      '**/node_modules/**',
      '**/snap-tests/**',
      './ecosystem-ci/**',
      './rolldown/**',
      './rolldown-vite/**',
      // FIXME: Error: failed to prepare the command for injection: Invalid argument (os error 22)
      'packages/*/binding/__tests__/',
    ],
  },
  fmt: {
    ignorePatterns: [
      '**/tmp/**',
      'packages/cli/snap-tests/fmt-ignore-patterns/src/ignored',
      'ecosystem-ci/*/**',
      'packages/test/**.cjs',
      'packages/test/**.cts',
      'packages/test/**.d.mjs',
      'packages/test/**.d.ts',
      'packages/test/**.mjs',
      'packages/test/browser/',
      'rolldown-vite',
      'rolldown',
    ],
    singleQuote: true,
    semi: true,
    experimentalSortPackageJson: true,
    experimentalSortImports: {
      groups: [
        ['type-import'],
        ['type-builtin', 'value-builtin'],
        ['type-external', 'value-external', 'type-internal', 'value-internal'],
        [
          'type-parent',
          'type-sibling',
          'type-index',
          'value-parent',
          'value-sibling',
          'value-index',
        ],
        ['ts-equals-import'],
        ['unknown'],
      ],
      newlinesBetween: true,
      order: 'asc',
    },
  },
  run: {
    tasks: {
      'build:src': {
        command: [
          'vp run @rolldown/pluginutils#build',
          'vp run rolldown#build-binding:release',
          'vp run rolldown#build-node',
          'vp run vite#build-types',
          'vp run @voidzero-dev/vite-plus-core#build',
          'vp run @voidzero-dev/vite-plus-test#build',
          'vp run vite-plus#build',
          'vp run vite-plus-cli#build',
        ].join(' && '),
      },
    },
  },
});
