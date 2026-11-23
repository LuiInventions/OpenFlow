"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const asar = require("@electron/asar");

const project = path.resolve(__dirname, "..");
const appDir = path.resolve(process.argv[2] || path.join(project, "release-local", "win-unpacked"));
const archive = path.join(appDir, "resources", "app.asar");
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}
const entries = asar.listPackage(archive).map(name => name.replaceAll("\\", "/").replace(/^\//, ""));
for (const entry of entries) {
  assert.ok(!/node_modules\/(?:node-llama-cpp|@node-llama-cpp|@reflink)\//.test(entry), `Unused native dependency: ${entry}`);
  assert.ok(!/(?:^|\/)(?:llama-host\.js|llama-worker\.js|note-models\.js|note-model-download\.html|shot\.js|listen-stop\.wav)$/.test(entry), `Unused file: ${entry}`);
}
const packaged = JSON.parse(asar.extractFile(archive, "package.json"));
assert.equal(packaged.version, require(path.join(project, "package.json")).version);
assert.deepEqual(Object.keys(packaged.dependencies || {}), ["sherpa-onnx-node"]);
for (const folder of ["electron", "renderer", "src"]) {
  for (const file of files(path.join(project, folder))) {
    const relative = path.relative(project, file);
    assert.ok(asar.extractFile(archive, relative).equals(fs.readFileSync(file)), `Source mismatch: ${relative}`);
  }
}
const resources = path.join(appDir, "resources");
const required = [
  "flameshot/bin/flameshot.exe", "flameshot/bin/Qt6Core.dll", "flameshot/bin/Qt6Gui.dll",
  "flameshot/bin/Qt6Widgets.dll", "flameshot/bin/platforms/qwindows.dll",
  "flameshot/bin/msvcp140.dll", "flameshot/bin/vcruntime140.dll", "flameshot/bin/vcruntime140_1.dll",
  "app.asar.unpacked/node_modules/sherpa-onnx-node/sherpa-onnx.js",
];
for (const relative of required) assert.ok(fs.existsSync(path.join(resources, relative)), `Missing runtime: ${relative}`);
assert.ok(!fs.existsSync(path.join(resources, "flameshot/bin/vc_redist.x64.exe")));
const native = files(path.join(resources, "app.asar.unpacked"));
assert.ok(native.some(file => file.includes("sherpa-onnx-win-x64") && file.endsWith(".node")));
assert.ok(!native.some(file => /node-llama-cpp|@node-llama-cpp|@reflink/.test(file)));
const totalBytes = files(appDir).reduce((total, file) => total + fs.statSync(file).size, 0);
assert.ok(totalBytes < 460 * 1024 * 1024, `Package unexpectedly large: ${totalBytes}`);
console.log(JSON.stringify({ verified: true, version: packaged.version, totalBytes, totalMiB: +(totalBytes / 1048576).toFixed(2) }));
