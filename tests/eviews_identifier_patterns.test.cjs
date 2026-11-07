'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { assignmentPattern, typeAnnotationPattern } = require('../out/eviews_identifier_patterns');

test('matches assignments while preserving names and placeholders', () => {
    const names = [
        '%series', '!index', 'plain_name', 'name{%suffix}',
        'n{%x}f{!j}jbbnp', '{%prefix}_suffix', 'foo{!j}{%k}'
    ];
    for (const name of names) {
        assert.equal(`${name} = 1`.match(assignmentPattern)?.[1], name);
    }
    assert.equal('foo + bar'.match(assignmentPattern), null);
});

test('matches type annotations and captures the type in group 2', () => {
    const match = '%value{!i} => SeRiEs'.match(typeAnnotationPattern);
    assert.equal(match?.[1], '%value{!i}');
    assert.equal(match?.[2], 'SeRiEs');
    assert.equal('plain_name no arrow'.match(typeAnnotationPattern), null);
});

test('long non-assignments do not cause catastrophic backtracking', () => {
    // Run in a child: a regression must fail quickly instead of hanging tests.
    const modulePath = require.resolve('../out/eviews_identifier_patterns');
    const code = `
        const { assignmentPattern, typeAnnotationPattern } = require(${JSON.stringify(modulePath)});
        const name = 'very_long_name_without_an_equals_sign_or_type_annotation';
        if (assignmentPattern.test(name + ' _')) process.exit(1);
        if (typeAnnotationPattern.test(name + ' not an annotation')) process.exit(2);
    `;
    const result = spawnSync(process.execPath, ['-e', code], {
        timeout: 2500,
        encoding: 'utf8'
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
});
