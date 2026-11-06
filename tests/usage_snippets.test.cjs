'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildUsageSnippetBodies } = require('../out/usage_snippets');

test('skips usage alternatives that do not contain the command keyword', () => {
  assert.deepEqual(
    buildUsageSnippetBodies('other arg\ncommand value\nunrelated', 'command'),
    [['command value', 'command${1: value}']]
  );
  assert.deepEqual(buildUsageSnippetBodies('other arg', 'command'), []);
});

test('keeps required @keywords literal rather than creating snippet placeholders', () => {
  assert.deepEqual(
    buildUsageSnippetBodies('command @required value @another [optional]', 'command'),
    [[
      'command @required value @another [optional]',
      'command @required${2: value} @another${4: [optional]}'
    ]]
  );
});

test('preserves the existing handling of parenthesized and optional arguments', () => {
  assert.deepEqual(buildUsageSnippetBodies('command(options)', 'command'),
    [['command(options)', 'command${1:(options)}']]);
  assert.deepEqual(buildUsageSnippetBodies('command(x,y)', 'command'),
    [['command(x,y)', 'command(${1:x,y})']]);
  assert.deepEqual(buildUsageSnippetBodies('command [options]', 'command'),
    [['command [options]', 'command${1: [options]}']]);
});
