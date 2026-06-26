require('./modern-module-resolution.js');
module.exports = {
  root: true,
  extends: ['./eslint/base'],
  overrides: [
    {
      files: ['**/*.ts'],
      parserOptions: {
        tsconfigRootDir: __dirname,
        project: ['tsconfig.json'],
      },
    },
  ],
};
