'use strict';

const assert = require('node:assert/strict');
const { test, beforeEach } = require('node:test');
const Module = require('node:module');
const fs = require('node:fs');

// Run the real compiled command callbacks with a lightweight VS Code stand-in.
// In particular, configuration writes and task execution can be deferred or fail.
Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

const commands = new Map();
const registered = [];
const state = {};
const disposable = (name = '') => ({ dispose() {}, name });

const vscode = {
  Uri: { file: (fsPath) => ({ fsPath }) },
  ConfigurationTarget: { Global: 1 },
  TaskScope: { Global: 1 },
  ProcessExecution: class {
    constructor(executable, args) { this.executable = executable; this.args = args; }
  },
  Task: class {
    constructor(definition, scope, name, source, execution) {
      Object.assign(this, { definition, scope, name, source, execution });
    }
  },
  window: {
    activeTextEditor: undefined,
    showOpenDialog(options) {
      state.dialogCalls.push(options);
      return state.dialogImpl(options);
    },
    showErrorMessage(message) { state.errors.push(message); },
    showWarningMessage(message) { state.warnings.push(message); }
  },
  commands: {
    registerCommand(id, callback) {
      commands.set(id, callback);
      const resource = disposable(id);
      registered.push(resource);
      return resource;
    },
    executeCommand() { throw new Error('Unexpected recursive executeCommand'); }
  },
  tasks: {
    executeTask(task) {
      state.tasks.push(task);
      return state.executeImpl(task);
    }
  },
  workspace: {
    textDocuments: [], workspaceFolders: [],
    getConfiguration() {
      return {
        get() { return state.setting; },
        update(key, value, target) {
          state.updates.push({ key, value, target });
          return state.updateImpl(value);
        }
      };
    },
    onDidOpenTextDocument: () => disposable(),
    onDidCloseTextDocument: () => disposable(),
    onDidChangeTextDocument: () => disposable(),
    onDidChangeWorkspaceFolders: () => disposable()
  },
  languages: {
    registerCompletionItemProvider: () => disposable(),
    registerHoverProvider: () => disposable(),
    registerSignatureHelpProvider: () => disposable()
  }
};

const originalLoad = Module._load;
const originalRead = fs.readFileSync;
let context;
try {
  Module._load = function (request, parent, isMain) {
    if (request === 'vscode') return vscode;
    return originalLoad.call(this, request, parent, isMain);
  };
  fs.readFileSync = function (file, ...args) {
    if (String(file).endsWith('keywords_detail.json')) return '{}';
    return originalRead.call(this, file, ...args);
  };
  const parser = require('../out/eviews_parser');
  parser.ParsedRoutinesCollection.prototype.monitor = function () {};
  context = { subscriptions: [], asAbsolutePath: (value) => value };
  require('../out/extension').activate(context);
} finally {
  Module._load = originalLoad;
  fs.readFileSync = originalRead;
}

const pathToEViews = 'C:\\Program Files\\EViews\\EViews14.exe';
const programPath = 'C:\\Models\\forecast.prg';
function editor({ dirty = false, save = async () => true, languageId = 'eviews-prg' } = {}) {
  return { document: {
    languageId, isDirty: dirty,
    uri: { scheme: 'file', fsPath: programPath }, save
  }};
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const run = () => commands.get('eviews.runEViews')();
const setPath = () => commands.get('eviews.setEViewsPath')();

beforeEach(() => {
  state.setting = pathToEViews;
  state.errors = [];
  state.warnings = [];
  state.dialogCalls = [];
  state.updates = [];
  state.tasks = [];
  state.dialogImpl = async () => undefined;
  state.updateImpl = async (value) => { state.setting = value; };
  state.executeImpl = async () => ({});
  vscode.window.activeTextEditor = editor();
});

test('both commands are registered for disposal', () => {
  assert.ok(commands.has('eviews.runEViews'));
  assert.ok(commands.has('eviews.setEViewsPath'));
  for (const id of commands.keys()) {
    assert.ok(context.subscriptions.includes(registered.find((d) => d.name === id)));
  }
});

test('configured executable launches active program and preserves per-file task identity', async () => {
  await run();
  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].execution.executable, pathToEViews);
  assert.deepEqual(state.tasks[0].execution.args, [programPath]);
  assert.deepEqual(state.tasks[0].definition, { type: 'eviewLaunchGroup', file: programPath });
  assert.deepEqual(state.updates, []);
  assert.deepEqual(state.errors, []);
});

test('first run waits for the path update before launching (without recursive command)', async () => {
  state.setting = undefined;
  const update = deferred();
  state.dialogImpl = async () => [{ fsPath: 'D:\\EViews14.EXE' }];
  state.updateImpl = async (value) => { await update.promise; state.setting = value; };
  const running = run();
  await new Promise(setImmediate);
  assert.equal(state.tasks.length, 0);
  assert.deepEqual(state.updates, [{ key: 'eviews-path', value: 'D:\\EViews14.EXE', target: 1 }]);
  update.resolve();
  await running;
  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].execution.executable, 'D:\\EViews14.EXE');
});

test('cancelling first-run path selection does not launch or report an error', async () => {
  state.setting = undefined;
  await run();
  assert.equal(state.tasks.length, 0);
  assert.equal(state.updates.length, 0);
  assert.deepEqual(state.errors, []);
});

test('first-run configuration write errors prevent launch and are reported', async () => {
  state.setting = undefined;
  state.dialogImpl = async () => [{ fsPath: pathToEViews }];
  state.updateImpl = async () => { throw new Error('settings locked'); };
  await run();
  assert.equal(state.tasks.length, 0);
  assert.match(state.errors[0], /Could not launch EViews: settings locked/);
});

test('failed task launch is reported and the command completes without rejection', async () => {
  state.executeImpl = async () => { throw new Error('task provider unavailable'); };
  await run();
  assert.equal(state.tasks.length, 1);
  assert.match(state.errors[0], /Could not launch EViews: task provider unavailable/);
});

test('run command waits for task execution scheduling', async () => {
  const execution = deferred();
  state.executeImpl = () => execution.promise;
  let settled = false;
  const running = run().then(() => { settled = true; });
  await new Promise(setImmediate);
  assert.equal(state.tasks.length, 1);
  assert.equal(settled, false);
  execution.resolve({});
  await running;
  assert.equal(settled, true);
});

test('run command still saves dirty documents before launching', async () => {
  let saved = false;
  vscode.window.activeTextEditor = editor({ dirty: true, save: async () => { saved = true; return true; } });
  await run();
  assert.equal(saved, true);
  assert.equal(state.tasks.length, 1);
});

test('save cancellation retains warning and does not launch', async () => {
  vscode.window.activeTextEditor = editor({ dirty: true, save: async () => false });
  await run();
  assert.equal(state.tasks.length, 0);
  assert.match(state.warnings[0], /Could not save/);
});

test('set-path command awaits the selected path being stored', async () => {
  state.dialogImpl = async () => [{ fsPath: 'D:\\New\\EViews.exe' }];
  const write = deferred();
  state.updateImpl = async (value) => { await write.promise; state.setting = value; };
  let settled = false;
  const changing = setPath().then(() => { settled = true; });
  await new Promise(setImmediate);
  assert.equal(settled, false);
  assert.deepEqual(state.updates, [{ key: 'eviews-path', value: 'D:\\New\\EViews.exe', target: undefined }]);
  write.resolve();
  await changing;
  assert.equal(state.setting, 'D:\\New\\EViews.exe');
  assert.equal(settled, true);
});

test('set-path cancel does not update configuration', async () => {
  await setPath();
  assert.equal(state.updates.length, 0);
  assert.deepEqual(state.errors, []);
});

test('set-path rejects invalid extension', async () => {
  state.dialogImpl = async () => [{ fsPath: 'C:\\Program Files\\EViews\\readme.txt' }];
  await setPath();
  assert.equal(state.updates.length, 0);
  assert.match(state.errors[0], /Please select an EViews executable/);
});

test('set-path reports configuration write errors', async () => {
  state.dialogImpl = async () => [{ fsPath: pathToEViews }];
  state.updateImpl = async () => { throw new Error('access denied'); };
  await setPath();
  assert.match(state.errors[0], /Could not set the EViews executable path: access denied/);
});

test('dialog failures are reported without unhandled rejection', async () => {
  state.setting = undefined;
  state.dialogImpl = async () => { throw new Error('dialog unavailable'); };
  await run();
  assert.equal(state.tasks.length, 0);
  assert.match(state.errors[0], /Could not launch EViews: dialog unavailable/);
});

test('run without an active EViews editor does not prompt or start a task', async () => {
  vscode.window.activeTextEditor = editor({languageId:'plaintext'});
  state.setting = undefined;
  await run();
  assert.equal(state.dialogCalls.length, 0);
  assert.equal(state.tasks.length, 0);
});
