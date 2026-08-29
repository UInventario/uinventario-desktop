import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'out/**'] },
  js.configs.recommended,
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
  },
];
