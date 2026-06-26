const path = require('path');

const prettierBin = path.join(
  'common',
  'autoinstallers',
  'rush-commitlint',
  'node_modules',
  '.bin',
  'prettier' + (process.platform === 'win32' ? '.cmd' : ''),
);

// Quote the binary path to be safe if any parent dirs contain spaces.
const prettierCmd = `"${prettierBin}" --config .prettierrc.yaml -w`;

module.exports = {
  ['*.{ts,tsx,js,jsx,mjs,cjs,ttml,ttss,css,scss,less,json}']: prettierCmd,
};
