const rnConfig = require('@react-native-community/eslint-config/index.js');

module.exports = {
  root: true,
  ignorePatterns: ['**/node_modules/**', '**/dist/**', '**/*.d.ts'],
  env: {
    browser: true,
    node: true,
    commonjs: true,
    es6: true,
    jest: true,
    mocha: true,
    es2017: true,
    es2020: true,
    worker: true,
  },
  parserOptions: {
    ecmaVersion: 11,
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
      legacyDecorators: true,
    },
  },
  globals: rnConfig.globals,
  plugins: ['@babel', 'import', 'lodash', ...rnConfig.plugins],
  settings: rnConfig.settings,
  rules: rnConfig.rules,
  overrides: [
    {
      files: ['**/*.d.ts'],
      rules: {
        'spaced-comment': 'off',
      },
    },
    {
      files: ['**/*.js', '**/*.mjs', '**/*.cjs', '**/*.jsx'],
      parser: '@babel/eslint-parser',
      parserOptions: {
        ecmaVersion: 11,
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
          legacyDecorators: true,
        },
        requireConfigFile: false,
        babelOptions: {
          configFile: false,
          plugins: [],
        },
      },
      plugins: ['ft-flow'],
      rules: {
        // Flow Plugin
        // The following rules are made available via `eslint-plugin-ft-flow`

        'ft-flow/define-flow-type': 1,
        'ft-flow/use-flow-type': 1,
      },
    },
    {
      files: ['**/*.ts', '**/*.tsx'],
      parser: '@typescript-eslint/parser',
      plugins: ['@typescript-eslint/eslint-plugin'],
      rules: {
        '@typescript-eslint/consistent-type-exports': ['error'],
        '@typescript-eslint/consistent-type-imports': ['warn'],
        '@typescript-eslint/no-unused-vars': [
          'error',
          {
            argsIgnorePattern: '^_',
            destructuredArrayIgnorePattern: '^_',
          },
        ],
        'no-unused-vars': 'off',
        'no-shadow': 'off',
        '@typescript-eslint/no-shadow': 1,
        'no-undef': 'off',
        'react/react-in-jsx-scope': 'off',
        'react/no-unstable-nested-components': [
          1,
          {
            allowAsProps: true,
          },
        ],
        'react-hooks/exhaustive-deps': ['warn', {}],
        '@typescript-eslint/no-unused-vars': [
          'warn',
          {
            argsIgnorePattern: '^_',
            destructuredArrayIgnorePattern: '^_',
            varsIgnorePattern: '^_',
          },
        ],
        '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'warn',
        '@typescript-eslint/prefer-optional-chain': 'warn',
        '@typescript-eslint/no-empty-interface': 'warn',
        '@typescript-eslint/no-duplicate-enum-values': 'warn',
        '@typescript-eslint/no-useless-constructor': 'warn',
        '@typescript-eslint/unified-signatures': 'warn',
        '@typescript-eslint/method-signature-style': 'warn',
        '@typescript-eslint/no-non-null-asserted-optional-chain': 'warn',
        '@typescript-eslint/no-namespace': [
          'warn',
          {
            // Discourage "namespace" in .ts and .tsx files
            allowDeclarations: false,

            // Allow it in .d.ts files that describe legacy libraries
            allowDefinitionFiles: false,
          },
        ],
        '@typescript-eslint/no-redundant-type-constituents': 'warn',

        '@typescript-eslint/no-misused-new': 'error',
        '@typescript-eslint/no-array-constructor': 'error',
        '@typescript-eslint/no-non-null-assertion': 'warn',
        '@typescript-eslint/no-extra-non-null-assertion': 'error',
        '@typescript-eslint/adjacent-overload-signatures': 'error',
        '@typescript-eslint/no-this-alias': 'error',
        '@typescript-eslint/no-unnecessary-type-constraint': 'error',
        '@typescript-eslint/no-loss-of-precision': 'error',
        '@typescript-eslint/no-unused-vars': ['warn', { args: 'none', argsIgnorePattern: '^_' }],
        '@typescript-eslint/prefer-as-const': 'error',
        '@typescript-eslint/prefer-namespace-keyword': 'error',

        '@typescript-eslint/no-implied-eval': 'error',

        '@typescript-eslint/only-throw-error': 'error',
        '@typescript-eslint/no-non-null-asserted-nullish-coalescing': 'error',
        '@typescript-eslint/prefer-literal-enum-member': 'error',

        '@typescript-eslint/no-dupe-class-members': 'error',
        'import/order': [
          'warn',
          {
            alphabetize: {
              caseInsensitive: true,
              order: 'asc',
            },
            groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'object'],
            'newlines-between': 'always',
            pathGroups: [
              {
                pattern: '@/**',
                group: 'internal',
                position: 'before',
              },
            ],
            pathGroupsExcludedImportTypes: ['builtin'],
          },
        ],
        'sort-imports': [
          'warn',
          {
            ignoreDeclarationSort: true,
          },
        ],
      },
    },
    {
      files: ['*.{spec,test}.{js,ts,tsx}', '**/__{mocks,tests}__/**/*.{js,ts,tsx}'],
      env: {
        jest: true,
      },
      rules: {
        'react-native/no-inline-styles': 0,
        quotes: [1, 'single', { avoidEscape: true, allowTemplateLiterals: true }],
      },
    },
  ],
};
