"use strict";

const { nsisWeb, ...base } = require("../package.json").build;

module.exports = {
  ...base,
  publish: null,
  directories: { ...base.directories, output: "release-local" },
  win: { ...base.win, target: ["nsis"] },
  nsis: { ...nsisWeb, artifactName: "OpenFlow-Setup-${version}-local.exe" },
};
