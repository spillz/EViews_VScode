'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const Module = require('node:module');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');

// Test the compiled production parser without launching a VS Code instance.
const documents = new Map();
const vscode = {
  Uri: {
    file(filePath) {
      const uri = pathToFileURL(filePath).href;
      return { fsPath: filePath, toString: () => uri };
    },
    parse(uri) {
      return { fsPath: fileURLToPath(uri), toString: () => uri };
    }
  },
  workspace: {
    async openTextDocument(request) {
      const uri = typeof request === 'string'
        ? pathToFileURL(request).href : request.toString();
      const document = documents.get(uri);
      if (!document) throw new Error(`Document not found: ${uri}`);
      return document;
    }
  }
};

const load = Module._load;
let ParsedFile;
let ParsedRoutinesCollection;
try {
  Module._load = function (request, parent, isMain) {
    if (request === 'vscode') return vscode;
    return load.call(this, request, parent, isMain);
  };
  ({ ParsedFile, ParsedRoutinesCollection } = require('../out/eviews_parser'));
} finally {
  Module._load = load;
}

const directory = path.join(process.cwd(), 'virtual-includes');
const filePath = (name) => path.join(directory, name);
const fileUri = (name) => vscode.Uri.file(filePath(name)).toString();

function addDocument(name, code) {
  const uri = vscode.Uri.file(filePath(name));
  documents.set(uri.toString(), { uri, getText: () => code });
}

function addVariable(file, name) {
  file.vars.push({
    type: 'SCALAR', name, lookupName: name.toUpperCase(),
    line: 0, annotatedType: false
  });
}

test('missing includes do not break local symbol lookup or collection', () => {
  const collection = new ParsedRoutinesCollection();
  const main = new ParsedFile(fileUri('main.prg'));
  collection.files[main.file.toString()] = main;
  main.includes.push({ uri: fileUri('missing.prg'), line: 0 });
  addVariable(main, 'local');

  assert.equal(main.getSymbol(collection, 'local', null, true)?.object.name,
    'local');
  assert.equal(main.getSymbol(collection, 'absent', null, true), undefined);
  assert.deepEqual(main.getAllSymbols(collection, null, true).map(
    (symbol) => symbol.object.name), ['local']);
});

test('a valid include after a missing include still contributes symbols', () => {
  const collection = new ParsedRoutinesCollection();
  const main = new ParsedFile(fileUri('main.prg'));
  const valid = new ParsedFile(fileUri('valid.prg'));
  main.includes.push({ uri: fileUri('missing.prg'), line: 0 });
  main.includes.push({ uri: fileUri('valid.prg'), line: 1 });
  addVariable(valid, 'remote');
  collection.files[main.file.toString()] = main;
  collection.files[valid.file.toString()] = valid;

  assert.equal(main.getSymbol(collection, 'remote', null, true)?.object.name,
    'remote');
  assert.deepEqual(main.getAllSymbols(collection, null, true).map(
    (symbol) => symbol.object.name), ['remote']);
});

test('an include contributes symbols once its pending parse completes', () => {
  const collection = new ParsedRoutinesCollection();
  const main = new ParsedFile(fileUri('main.prg'));
  main.includes.push({ uri: fileUri('pending.prg'), line: 0 });
  collection.files[main.file.toString()] = main;

  assert.equal(main.getSymbol(collection, 'later', null, true), undefined);
  const parsed = new ParsedFile(fileUri('pending.prg'));
  addVariable(parsed, 'later');
  collection.files[parsed.file.toString()] = parsed;
  assert.equal(main.getSymbol(collection, 'later', null, true)?.object.name,
    'later');
});

test('include cycles terminate and transitive includes remain accessible', () => {
  const collection = new ParsedRoutinesCollection();
  const files = ['a.prg', 'b.prg', 'c.prg'].map(
    (name) => new ParsedFile(fileUri(name)));
  files.forEach((file) => {
    collection.files[file.file.toString()] = file;
  });
  files[0].includes.push({ uri: files[1].file.toString(), line: 0 });
  files[1].includes.push({ uri: files[2].file.toString(), line: 0 });
  files[2].includes.push({ uri: files[0].file.toString(), line: 0 });
  addVariable(files[2], 'transitive');

  assert.equal(files[0].getSymbol(collection, 'transitive', null, true)
    ?.object.name, 'transitive');
  assert.deepEqual(files[0].getAllSymbols(collection, null, true).map(
    (symbol) => symbol.object.name), ['transitive']);
});

test('failed include opens retain canonical file URI keys', async () => {
  documents.clear();
  addDocument('main.prg', 'include "missing.prg"');
  const collection = new ParsedRoutinesCollection();
  const main = new ParsedFile(fileUri('main.prg'));

  await main.parse(collection);

  assert.equal(main.includes.length, 1);
  assert.equal(main.includes[0].uri, fileUri('missing.prg'));
  assert.deepEqual(collection.queue, [fileUri('missing.prg')]);
  assert.equal(main.getSymbol(collection, 'absent', null, true), undefined);
  assert.deepEqual(main.getAllSymbols(collection, null, true), []);
});

test('valid includes are resolved normally after parsing', async () => {
  documents.clear();
  addDocument('parent.prg', 'include "child.prg"');
  addDocument('child.prg', 'scalar from_child');
  const collection = new ParsedRoutinesCollection();
  const parent = new ParsedFile(fileUri('parent.prg'));

  await parent.parse(collection);
  assert.equal(parent.getSymbol(collection, 'from_child', null, true),
    undefined);
  await collection.parse(fileUri('child.prg'));
  assert.equal(parent.getSymbol(collection, 'from_child', null, true)
    ?.object.name, 'from_child');
});
