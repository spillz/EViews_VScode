'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { prepareProgramForRun } = require('../out/eviews_run_prep');

const programPath = 'C:\\models\\model.prg';

function makeDocument({ isDirty = false, scheme = 'file', fsPath = programPath,
                        saveResult = true } = {}) {
  let saveCalls = 0;
  const doc = {
    uri: { scheme, fsPath },
    isDirty,
    async save() {
      saveCalls++;
      if (saveResult instanceof Error) throw saveResult;
      return saveResult;
    }
  };
  return { doc, getSaveCalls: () => saveCalls };
}

test('runs clean file documents without saving unnecessarily', async () => {
  const { doc, getSaveCalls } = makeDocument();
  assert.deepEqual(await prepareProgramForRun(doc),
    { ready: true, filePath: programPath });
  assert.equal(getSaveCalls(), 0);
});

test('saves a modified file and waits before returning its path', async () => {
  let resolveSave;
  let saveCalls = 0;
  const doc = {
    uri: { scheme: 'file', fsPath: programPath },
    isDirty: true,
    save() {
      saveCalls++;
      return new Promise(resolve => { resolveSave = resolve; });
    }
  };
  let settled = false;
  const preparation = prepareProgramForRun(doc).then(value => {
    settled = true;
    return value;
  });
  await Promise.resolve();
  assert.equal(saveCalls, 1);
  assert.equal(settled, false, 'must not launch before save completes');
  resolveSave(true);
  assert.deepEqual(await preparation,
    { ready: true, filePath: programPath });
});

test('cancels the launch if saving returns false', async () => {
  const { doc, getSaveCalls } = makeDocument({ isDirty: true, saveResult: false });
  assert.deepEqual(await prepareProgramForRun(doc),
    { ready: false, reason: 'save-failed' });
  assert.equal(getSaveCalls(), 1);
});

test('cancels the launch if saving rejects', async () => {
  const { doc } = makeDocument({ isDirty: true, saveResult: new Error('disk full') });
  assert.deepEqual(await prepareProgramForRun(doc),
    { ready: false, reason: 'save-failed' });
});

test('rejects untitled or virtual documents before attempting a save', async () => {
  for (const scheme of ['untitled', 'vscode-remote']) {
    const { doc, getSaveCalls } = makeDocument({ isDirty: true, scheme });
    assert.deepEqual(await prepareProgramForRun(doc),
      { ready: false, reason: 'not-file' });
    assert.equal(getSaveCalls(), 0);
  }
});
