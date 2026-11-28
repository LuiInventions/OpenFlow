"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const root = path.resolve(__dirname,"..");
const {version} = require("../package.json");
const names = [`OpenFlow-Setup-${version}.exe`, `OpenFlow-Setup-${version}-local.exe`, `openflow-${version}-x64.nsis.7z`, "latest.yml"];
function walk(dir) {
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
    const file=path.join(dir,entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}
const inputs = ["release","release-local"].flatMap(dir=>walk(path.join(root,dir)));
const output=path.join(root,"release-artifacts"); fs.mkdirSync(output,{recursive:true});
for(const name of names) {
  const matches=inputs.filter(file=>path.basename(file)===name);
  assert.equal(matches.length,1,`Expected one ${name}, found ${matches.length}`);
  assert.ok(fs.statSync(matches[0]).size>0,`${name} is empty`);
  fs.copyFileSync(matches[0],path.join(output,name));
}
const digest=(name,algorithm,encoding)=>crypto.createHash(algorithm).update(fs.readFileSync(path.join(output,name))).digest(encoding);
const update=yaml.load(fs.readFileSync(path.join(output,"latest.yml"),"utf8"));
assert.equal(update.version,version);
assert.equal(update.path,names[0]);
assert.equal(update.sha512,digest(names[0],"sha512","base64"));
assert.equal(update.packages.x64.path,names[2]);
assert.equal(update.packages.x64.sha512,digest(names[2],"sha512","base64"));
assert.equal(update.packages.x64.size,fs.statSync(path.join(output,names[2])).size);
fs.writeFileSync(path.join(output,"SHA256SUMS.txt"),names.map(name=>`${digest(name,"sha256","hex")}  ${name}`).join("\n")+"\n");
console.log(JSON.stringify({verified:true,version,assets:[...names,"SHA256SUMS.txt"]}));
