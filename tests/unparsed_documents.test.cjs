'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const Module = require('node:module');
const fs = require('node:fs');

// Exercise the actual compiled language providers without starting VS Code.
// Simulate the short interval before ParsedRoutinesCollection has parsed a file.
class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}
class Range {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
}
class CompletionItem {
  constructor(label, kind) {
    this.label = label;
    this.kind = kind;
  }
}
class SnippetString {
  constructor(value) {
    this.value = value;
  }
}
class MarkdownString {
  constructor(value) {
    this.value = value;
  }
}
class Hover {
  constructor(contents) {
    this.contents = contents;
  }
}
class SignatureHelp {
  constructor() {
    this.signatures = [];
  }
}
class SignatureInformation {
  constructor(label, documentation) {
    this.label = label;
    this.documentation = documentation;
    this.parameters = [];
  }
}
class ParameterInformation {
  constructor(label, documentation) {
    this.label = label;
    this.documentation = documentation;
  }
}
const providers = {};
const disposable = () => ({ dispose() {} });
const vscode = {
  Position, Range, CompletionItem, SnippetString, MarkdownString, Hover,
  SignatureHelp, SignatureInformation, ParameterInformation,
  CompletionItemKind: { Keyword: 1, Function: 2, Method: 3 },
  Uri: {
    parse: (value) => ({ fsPath: value, toString: () => value }),
    file: (value) => ({ fsPath: value, toString: () => value })
  },
  languages: {
    registerCompletionItemProvider(_selector, provider) {
      providers.completion = provider;
      return disposable();
    },
    registerSignatureHelpProvider(_selector, provider) {
      providers.signature = provider;
      return disposable();
    },
    registerHoverProvider(_selector, provider) {
      providers.hover = provider;
      return disposable();
    }
  },
  commands: { registerCommand: () => disposable() },
  workspace: {
    textDocuments: [], workspaceFolders: [],
    onDidOpenTextDocument: () => disposable(),
    onDidCloseTextDocument: () => disposable(),
    onDidChangeTextDocument: () => disposable(),
    onDidChangeWorkspaceFolders: () => disposable()
  }
};

const groups = [
  'Programming', 'Commands', 'Element Information', 'Functions',
  'Operators', 'General Information', 'Basic Workfile Functions',
  'Dated Workfile Information', 'Panel Workfile Functions'
];
const keywords = Object.fromEntries(groups.map((name) => [name, {}]));
const info = (usage, description = usage) => ({
  usage, description, uri: 'example', anchor: ''
});
keywords.Programming.include = info('include "file"');
keywords.Programming.subroutine = info('subroutine name');
keywords.Commands.scalar = info('scalar variable');
keywords.Functions['@abs'] = info('@abs(value)', 'Absolute value');
keywords.Scalar = { '[Scalar]': info('scalar variable') };

const originalLoad = Module._load;
const originalRead = fs.readFileSync;
let collection;
try {
  Module._load = function (request, parent, isMain) {
    if (request === 'vscode') return vscode;
    return originalLoad.call(this, request, parent, isMain);
  };
  fs.readFileSync = function (file, ...args) {
    if (String(file).endsWith('keywords_detail.json')) {
      return JSON.stringify(keywords);
    }
    return originalRead.call(this, file, ...args);
  };
  const parser = require('../out/eviews_parser');
  parser.ParsedRoutinesCollection.prototype.monitor = function () {
    collection = this;
  };
  require('../out/extension').activate({
    subscriptions: [],
    asAbsolutePath: (relative) => relative
  });
} finally {
  Module._load = originalLoad;
  fs.readFileSync = originalRead;
}

function doc(source, start, end = start + source.length) {
  const uri = { toString: () => 'file:///test/unparsed.prg' };
  return {
    uri,
    getWordRangeAtPosition() {
      if (start === null) return undefined;
      return new Range(new Position(0, start), new Position(0, end));
    },
    getText(range) {
      if (!range) return source;
      return source.slice(range.start.character, range.end.character);
    },
    lineAt() {
      return { text: source, range: { end: new Position(0, source.length) } };
    }
  };
}
const cursor = (source) => new Position(0, source.length);
const mockToken = {};

// No file entry is present in the parser collection for these tests.
test('built-in keyword completions work before initial parsing', () => {
  const source = 'sca';
  const items = providers.completion.provideCompletionItems(
    doc(source, 0, 3), cursor(source), mockToken, {});
  assert.ok(items.some((item) => item.label === 'scalar'));
  assert.ok(items.some((item) => item.label === '@abs'));
});

test('subroutine completion without parsed symbols does not throw', () => {
  const source = 'call ';
  const items = providers.completion.provideCompletionItems(
    doc(source, null), cursor(source), mockToken, {});
  assert.deepEqual(items, []);
});

test('dotted completion does not fabricate an unknown-type suggestion', () => {
  const source = 'unknown.';
  const items = providers.completion.provideCompletionItems(
    doc(source, 0, source.length), cursor(source), mockToken, {});
  assert.deepEqual(items, []);
});

test('type-annotation completions tolerate missing parsed symbols', () => {
  const source = "'@type foo";
  const items = providers.completion.provideCompletionItems(
    doc(source, 7, 10), cursor(source), mockToken, {});
  assert.deepEqual(items, []);
});

test('built-in signature help is available before parsing', () => {
  const source = '@abs(';
  const help = providers.signature.provideSignatureHelp(
    doc(source, 1, 4), cursor(source), mockToken, {});
  assert.equal(help.signatures[0].label, '@abs(value)');
});

test('user-defined and object signature help tolerate missing parser state', () => {
  for (const source of ['call missing(', 'unknown.method(']) {
    assert.doesNotThrow(() => providers.signature.provideSignatureHelp(
      doc(source, 0, 4), cursor(source), mockToken, {}));
  }
});

test('built-in hover remains available before parsing', () => {
  const source = 'scalar';
  const hover = providers.hover.provideHover(
    doc(source, 0, 6), cursor(source), mockToken);
  assert.match(hover.contents.value, /scalar variable/);
});

test('hover on unknown names and methods waits for parsing', () => {
  for (const [source, start, end] of [
    ['unknown', 0, 7], ['unknown.method', 8, 14]
  ]) {
    const hover = providers.hover.provideHover(
      doc(source, start, end), cursor(source), mockToken);
    assert.equal(hover, undefined);
  }
});

test('include hover tolerates an unparsed document', () => {
  const source = 'include "missing.prg"';
  const filename = providers.hover.provideHover(
    doc(source, 9, 16), cursor(source), mockToken);
  assert.match(filename.contents.value, /Unresolved include file/);
  const keyword = providers.hover.provideHover(
    doc(source, 0, 7), cursor(source), mockToken);
  assert.match(keyword.contents.value, /include/);
});

test('parsed file still contributes user-defined symbols', () => {
  const source = 'obs';
  const uri = 'file:///test/unparsed.prg';
  const file = { toString: () => uri, fsPath: '/test/unparsed.prg' };
  collection.files[uri] = {
    file,
    includes: [],
    getSymbol() { return undefined; },
    getAllSymbols() {
      return [{
        object: {
          name: 'observed', type: 'SCALAR', line: 0,
          annotatedType: false
        },
        file, scope: 'global'
      }];
    }
  };
  const items = providers.completion.provideCompletionItems(
    doc(source, 0, 3), cursor(source), mockToken, {});
  assert.ok(items.some((item) => item.label === 'observed'));
  delete collection.files[uri];
});
