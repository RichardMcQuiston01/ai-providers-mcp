import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/typedef': [
        'error',
        { variableDeclaration: true, variableDeclarationIgnoreFunction: true },
      ],
      // stdout belongs to the MCP protocol: only console.error/warn (stderr).
      'no-console': ['error', { allow: ['error', 'warn'] }],
      'no-restricted-globals': [
        'error',
        {
          name: 'process',
          message:
            'Only src/config.ts may read process.env. Pass values in as arguments.',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          message: 'process is restricted to src/config.ts.',
        },
      ],
    },
  },
  {
    // The one file allowed to touch the process environment.
    files: ['src/config.ts'],
    rules: {
      'no-restricted-globals': 'off',
      'no-restricted-properties': 'off',
    },
  },
  {
    files: ['eslint.config.js'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/typedef': 'off',
    },
  }
);
