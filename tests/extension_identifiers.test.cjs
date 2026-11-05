'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const {
    completionWordPattern, dottedReferencePattern, hoverWordPattern,
    signatureObjectPattern, typeArrowReferencePattern
} = require('../out/eviews_identifiers');

test('signature help extracts the object preceding a method', () => {
    for (const name of ['series', 'foo{%suffix}', '{%prefix}x', '{%prefix}2', 'foo{!i}{%j}']) {
        assert.equal(`${name}.`.match(signatureObjectPattern)?.[1], name);
    }
    assert.equal('long_object_name_without_a_dot'.match(signatureObjectPattern), null);
});

test('completion and hover recognize dotted references and type arrows', () => {
    for (const name of ['series', 'foo{%suffix}bar', '{!index}x', '@func']) {
        assert.equal(`${name}.`.match(dottedReferencePattern)?.[0], `${name}.`);
        assert.equal(`${name}=>`.match(typeArrowReferencePattern)?.[0], `${name}=>`);
    }
    assert.equal('series'.match(dottedReferencePattern), null);
    assert.equal('series'.match(typeArrowReferencePattern), null);
    assert.equal('series+'.match(dottedReferencePattern), null);
});

test('word ranges preserve EViews identifiers and substitutions', () => {
    for (const name of ['abc', '%alpha', '!i', '@func', 'foo{%bar}baz',
                        'foo{!j}{%k}', '{%prefix}suffix']) {
        assert.equal(name.match(completionWordPattern)?.[0], name);
        assert.equal(name.match(hoverWordPattern)?.[0], name);
    }
    assert.equal('foo{%bar}.'.match(completionWordPattern)?.[0], 'foo{%bar}.');
    assert.equal("'@type".match(completionWordPattern)?.[0], '@type');
    assert.equal('!'.match(completionWordPattern)?.[0], '!');
});

test('long identifiers without dot/arrow cannot block the extension host', () => {
    // Timeout protects the test suite if a future change restores the old regex.
    const modulePath = require.resolve('../out/eviews_identifiers');
    const code = `
        const {
          signatureObjectPattern, dottedReferencePattern,
          typeArrowReferencePattern, completionWordPattern, hoverWordPattern
        } = require(${JSON.stringify(modulePath)});
        const line = 'a'.repeat(200);
        for (let i = 0; i < 20; i++) {
            if (signatureObjectPattern.test(line)) process.exit(1);
            if (dottedReferencePattern.test(line)) process.exit(2);
            if (typeArrowReferencePattern.test(line)) process.exit(3);
            if (!completionWordPattern.test(line)) process.exit(4);
            if (!hoverWordPattern.test(line)) process.exit(5);
        }
    `;
    const result = spawnSync(process.execPath, ['-e', code], {
        timeout: 2500,
        encoding: 'utf8'
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr);
});
