import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores([
    '**/dist/**',
    '**/node_modules/**',
    'playwright-report/**',
    'test-results/**',
    '**/coverage/**',
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['error', 'warn'] }],
    },
  },
  {
    // Everything that runs in the browser: the client app, the design system, game boards.
    files: [
      'apps/client/src/**/*.{ts,tsx}',
      'packages/ui/src/**/*.{ts,tsx}',
      'games/*/src/client/**/*.{ts,tsx}',
    ],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // The server logger and command-line tools are allowed to write to stdout.
    files: ['apps/server/src/log.ts', 'tools/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
]);
