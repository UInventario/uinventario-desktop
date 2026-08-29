import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'out/**', 'dist/**'] },
  js.configs.recommended,
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
  },
  {
    files: ['src/*-preload.cjs', 'src/preload.cjs', 'electron-builder.config.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    files: ['src/customer-display.js'],
    languageOptions: {
      globals: globals.browser,
    },
  },
];
