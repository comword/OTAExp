require('@gtdev/eslint-config/modern-module-resolution');
module.exports = {
  root: true,
  extends: ['@gtdev/eslint-config/eslint/react-native'],
  overrides: [
    {
      files: ['**/*.ts', '**/*.tsx'],
      parserOptions: {
        tsconfigRootDir: __dirname,
        project: ['tsconfig.json'],
      },
    },
  ],
};
