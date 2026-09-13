#!/usr/bin/env node
'use strict';
// Offline CLI uses the exact browser importer. Output contains private answer
// keys; write it outside the public site checkout and never commit the output.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
function importer() {
  const context = {window: {}, TextDecoder, TextEncoder, Blob, DecompressionStream, DataView, Uint8Array};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/content-importer.js'), 'utf8'), context, {filename: 'content-importer.js'});
  return context.window.ScienceContentImporter;
}
function fromDirectory(directory) {
  const files = Object.create(null);
  function walk(dir, prefix = '') { for (const entry of fs.readdirSync(dir, {withFileTypes: true})) { const relative = prefix + entry.name; if (entry.isDirectory()) walk(path.join(dir, entry.name), relative + '/'); else if (entry.isFile() && relative !== 'lesson.json') files[relative] = fs.readFileSync(path.join(dir, entry.name), 'utf8'); } }
  walk(directory); return {manifest: JSON.parse(fs.readFileSync(path.join(directory, 'lesson.json'), 'utf8')), files};
}
function convert(sourcePath) { const source = fs.statSync(sourcePath).isDirectory() ? fromDirectory(sourcePath) : JSON.parse(fs.readFileSync(sourcePath, 'utf8')); return importer().convertSource(source.manifest, source.files); }
module.exports = {importer, fromDirectory, convert};
if (require.main === module) {
  const source = process.argv[2], target = process.argv[3];
  if (!source || !target) throw new Error('Usage: node tests/convert-source.cjs <source directory or JSON> <private output JSON>');
  const output = path.resolve(target), site = path.resolve(__dirname, '..');
  if (output === site || output.startsWith(site + path.sep)) throw new Error('Private output must be outside the public site checkout.');
  fs.mkdirSync(path.dirname(output), {recursive: true}); fs.writeFileSync(output, JSON.stringify(convert(source)), {mode: 0o600});
  console.log('Converted one lesson; private output written outside the public site.');
}
