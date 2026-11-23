// Exercise the real packaged script helper while blocking Electron's temporary copy path.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const archive = path.resolve(process.argv[2] || path.join(__dirname, '..', 'release-local', 'win-unpacked', 'resources', 'app.asar'));
const profile = path.join(__dirname, '..', '.cache', 'script-copy-check');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
process.env.OPENFLOW_SMOKE = '1';
const exit = app.exit.bind(app);
app.exit = code => { if (code) exit(code); };
const originalCopy = fs.copyFileSync;
fs.copyFileSync = function(source, ...args) {
  if (String(source).includes('.asar') && String(source).endsWith('.ps1')) {
    const error = new Error('Simulated missing Electron extraction file');
    error.code = 'ENOENT';
    throw error;
  }
  return originalCopy.call(this, source, ...args);
};
try {
  const filename = path.join(archive, 'electron', 'main.cjs');
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(fs.readFileSync(filename, 'utf8') + '\nmodule.exports = { scriptCopy };', filename);
  for (let attempt = 0; attempt < 30; attempt++) {
    for (const name of ['chord.ps1', 'paste.ps1', 'unmute.ps1', 'micrepair.ps1']) {
      const destination = loaded.exports.scriptCopy(name);
      assert.equal(destination, path.join(profile, name));
      assert.deepEqual(fs.readFileSync(destination), fs.readFileSync(path.join(archive, 'electron', name)));
    }
  }
  console.log('PASS: 120 script deployments from real ASAR; exact contents; copyFileSync extraction path disabled.');
  exit(0);
} catch (error) {
  console.error(error);
  exit(1);
}
