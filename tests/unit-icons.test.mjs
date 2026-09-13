import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const context = { window: {} };
vm.runInNewContext(readFileSync(new URL('../assets/unit-icons.js', import.meta.url), 'utf8'), context);
const icons = context.window.ScienceUnitIcons;

test('unit icon choices keep stable identifiers and readable Korean labels', () => {
  const expected = ['car', 'element', 'flask', 'galaxy', 'sun', 'earth', 'lightning', 'light', 'star', 'space', 'compound', 'matter', 'flower', 'animal', 'cell', 'leaf', 'tree', 'computer', 'book', 'magnet', 'wave'];
  assert.deepEqual(Array.from(icons.all, icon => icon.id), expected);
  assert.equal(new Set(icons.all.map(icon => icon.svg)).size, expected.length);
  for (const icon of icons.all) {
    assert.match(icon.label, /^[가-힣]+$/);
    assert.equal(icons.get(icon.id), icon);
  }
  for (const unknown of [null, undefined, '', '__proto__', 'constructor', '<svg>', {}]) {
    assert.equal(icons.get(unknown), undefined);
  }
});

test('catalogue is immutable and never accepts external SVG content', () => {
  assert.ok(Object.isFrozen(icons));
  assert.ok(Object.isFrozen(icons.all));
  for (const icon of icons.all) {
    assert.ok(Object.isFrozen(icon));
    assert.match(icon.svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 48 48"/);
    assert.match(icon.svg, /aria-hidden="true"/);
    assert.match(icon.svg, /focusable="false"/);
    assert.match(icon.svg, /stroke="currentColor"/);
    assert.doesNotMatch(icon.svg, /<\/?(?:script|style|foreignObject|image|use|a|text)\b|\bon\w+=|(?:href|src|id)=|url\(|data:|javascript:/i);
    const tags = [...icon.svg.matchAll(/<\/?([a-zA-Z]+)/g)].map(match => match[1]);
    assert.ok(tags.every(tag => ['svg', 'path', 'circle', 'ellipse', 'rect'].includes(tag)));
  }
});
