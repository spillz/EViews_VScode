import { CancellationToken, Position, TextDocument, Uri } from 'vscode';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Key } from 'readline';
import { eventNames } from 'process';
import * as ev from './eviews_parser';

export const Exec_In_Terminal_Icon = 'eviews.execInTerminal-icon';


// export interface ICommandNameArgumentTypeMapping extends ICommandNameWithoutArgumentTypeMapping {
//     ['vscode.openWith']: [Uri, string];
//     [Exec_In_Terminal_Icon]: [Uri, string];
// }

type KeywordInfo = {
  usage: string,
  description: string,
  longDescription?: string,
  uri: string,
  anchor: string,
}

function docUri(kwi:KeywordInfo) {
  const end = kwi.anchor===''?kwi.uri+'.html':kwi.uri+'.html#'+kwi.anchor;
  return 'https://help.eviews.com/#page/content/'+end;
}

type EViewsGroupKeywords = {[keyword:string]:KeywordInfo};

var eviewsGroups:{[grpId:string]:EViewsGroupKeywords};
var openFolders: vscode.Uri[];
var parserCollection: ev.ParsedRoutinesCollection;


export function activate(context: vscode.ExtensionContext) {
  parserCollection = new ev.ParsedRoutinesCollection();
  parserCollection.monitor()
  openFolders = vscode.workspace.workspaceFolders? vscode.workspace.workspaceFolders.map((folder)=>folder.uri):[];

  console.log('"EViews Language Extensions" is now active.');
  const fullFilePath = context.asAbsolutePath(path.join('resources', 'keywords_detail.json'));
  const keywordData = JSON.parse(fs.readFileSync(fullFilePath, 'utf-8'));
  eviewsGroups = {};
  const grps = Object.keys(keywordData)
  for(let grp of grps) {
    eviewsGroups[grp] = {}
    const grpkw :EViewsGroupKeywords = {};
    const kwds = Object.keys(keywordData[grp])
    for(let kwd of kwds) {
      const kwjson = keywordData[grp][kwd]
      const kwinfo: KeywordInfo = {
        usage: kwjson.usage??'',
        description: kwjson.description??'',
        longDescription: kwjson.long_description??'',
        uri: kwjson.uri??'',
        anchor: kwjson.anchor??'',
      }
      eviewsGroups[grp][kwd] = kwinfo;
    }
  }

  const openDocs = vscode.workspace.textDocuments.filter((doc)=>doc.languageId==='eviews-prg');
  for(let doc of openDocs) {
    console.log('parsing',doc.uri.toString());
    parserCollection.push(doc.uri.toString());
    console.log('parsing began',doc.uri.toString());
  }

  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument((doc)=> {
    console.log('Doc opened',doc.uri);
    if(doc.languageId==='eviews-prg') {
      // parserCollection.push(doc.uri.toString());
    }
  }));

  context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((doc)=> {
    // console.log('Doc closed',doc.uri);
  }));

  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event)=> {
    // console.log('Changed',event.document.uri, event.contentChanges.length);
    parserCollection.push(event.document.uri.toString());
  }));

  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders((event)=> {
    if(event.added.length>0) {
      // console.log('Folder added',event.added);
    }
    if(event.removed.length>0) {
      // console.log('Folder removed',event.removed);
    }
  }));
  const cprov = vscode.languages.registerCompletionItemProvider(
    'eviews-prg',
    new (class implements vscode.CompletionItemProvider {
      provideCompletionItems(
        document: TextDocument, 
        position: Position, 
        token: CancellationToken, 
        context: vscode.CompletionContext): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList<vscode.CompletionItem>> {
        const items:vscode.CompletionItem[] = [];
        let range = document.getWordRangeAtPosition(position, /([!%@]|[!%@]?(?:[a-zA-Z_]\w*|\{[%][a-zA-Z_]\w*\})+\.?)/i);
        const file = parserCollection.files[document.uri.toString()];
        if(range!==undefined) {
          const word = document.getText(range).toLowerCase();
          const line = document.lineAt(position).text;
          const dottedRange = document.getWordRangeAtPosition(range.start, /[!%@]?(?:[a-zA-Z_]\w*|\{[%][a-zA-Z_]\w*\})+\./i)
          if(word.endsWith('.') || !word.endsWith('.') && word.length>0 && dottedRange!=undefined) { //Trigger for method completion is either a . or beginning of a word after a .
            if(word.endsWith('.')) range = document.getWordRangeAtPosition(position);
            let obj = word.endsWith('.')? word : document.getText(dottedRange); //Extract the parent object name
            obj = obj.slice(0,obj.length-1).toLowerCase();
            const symbol = file.getSymbol(parserCollection, obj, position.line, true);
            if(symbol) {
              if(symbol.object instanceof ev.ParsedSub) {
                return;
              }
              else if(symbol.object instanceof String || typeof(symbol.object)==='string') {
                return;
              } else { //Variable
                const type = symbol.object.type.toLowerCase();
                const capType = type[0].toUpperCase()+type.slice(1);
                if(capType in eviewsGroups) {
                  for(let meth in eviewsGroups[capType]) {
                    const ci = new vscode.CompletionItem(meth, vscode.CompletionItemKind.Method);
                    ci.documentation = `${capType} method ${meth}`+'\n\n'+eviewsGroups[capType][meth]['description'];
                    ci.detail = eviewsGroups[capType][meth]['usage'];
                    ci.range = range;
                    ci.preselect = true;
                    items.push(ci);        
                  }
                }
              }
            }
            if(items.length==0) {
              const ci = new vscode.CompletionItem('<No methods for unknown object type>', vscode.CompletionItemKind.Method);
              items.push(ci);
            }
          } else {
            for(let concept of ['Programming','Commands']) {
              for(const kw in eviewsGroups[concept]) {
                if(kw[0]=='[') continue;
                const ci = new vscode.CompletionItem(kw, vscode.CompletionItemKind.Keyword);
                ci.documentation = eviewsGroups[concept][kw]['description'];
                ci.detail = eviewsGroups[concept][kw]['usage'];
                ci.range = range;
                items.push(ci);  
              // if(kw.toLowerCase().startsWith(word.toLowerCase())) {
              //     const ci = new vscode.CompletionItem(kw, vscode.CompletionItemKind.Keyword);
              //     ci.documentation = eviewsGroups[concept][kw]['description'];
              //     ci.detail = eviewsGroups[concept][kw]['usage'];
              //     items.push(ci);  
              //   }
              }
            }
            for(let concept of ['Element Information','Functions','Operators','General Information','Basic Workfile Functions','Dated Workfile Information','Panel Workfile Functions']) {
              for(const kw in eviewsGroups[concept]) {
                if(kw[0]=='[') continue;
                const ci = new vscode.CompletionItem(kw, vscode.CompletionItemKind.Function);
                ci.documentation = eviewsGroups[concept][kw]['description'];
                ci.detail = eviewsGroups[concept][kw]['usage'];
                ci.range = range;
                items.push(ci);
              // if(kw.toLowerCase().startsWith(word.toLowerCase())) {
              //     const ci = new vscode.CompletionItem(kw, vscode.CompletionItemKind.Keyword);
              //     ci.documentation = eviewsGroups[concept][kw]['description'];
              //     ci.detail = eviewsGroups[concept][kw]['usage'];
              //     items.push(ci);  
              //   }
              }
            }
            const symbols = file.getAllSymbols(parserCollection, document.lineAt(position).lineNumber, true);
            for(const symbol of symbols) {
              if(symbol.object instanceof ev.ParsedSub) {
                const name = symbol.object.name.toLowerCase();
                const type = 'subroutine';
                const scope = symbol.scope;
                const capType = type[0].toUpperCase()+type.slice(1);
                const concept = 'Programming';
                if(type in eviewsGroups[concept]) {
                  const info = eviewsGroups[concept][type];
                  const ci = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
                  const fileInfo = file.file.toString()===symbol.file.toString()? '':`\n\n${symbol.file.toString()}`;
                  ci.documentation = `${capType}: ${info.description}`+fileInfo;
                  ci.detail = `${capType} ${name} (${scope})`;
                  ci.range = range;
                  items.push(ci);
                }
              }
              else if(symbol.object instanceof String || typeof(symbol.object)==='string') {
  
              }
              else { //Variable
                const name = symbol.object.name.toLowerCase();
                const type = symbol.object.type.toLowerCase();
                const scope = symbol.scope;
                const capType = type[0].toUpperCase()+type.slice(1);
                const concept = 'Commands';
                if(`[${capType}]` in eviewsGroups[capType]) {
                  const info = eviewsGroups[capType][`[${capType}]`];
                  const ci = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
                  const fileInfo = file.file.toString()===symbol.file.toString()? '':`\n\n${symbol.file.toString()}`;
                  ci.documentation = `${info.description}`+fileInfo;
                  ci.detail = `${capType} ${name} (${scope})`;
                  ci.range = range;
                  items.push(ci);
                }
              }  
            }
          }
          return items;
        }
      }
      resolveCompletionItem(item: vscode.CompletionItem, token: CancellationToken): vscode.ProviderResult<vscode.CompletionItem> {
        console.log('Resolve completion item', item.documentation, item.detail)
        return item;
      }
    })(), 
    '@',
    '.',
    '%',
    '!',
  );
  const hprov = vscode.languages.registerHoverProvider(
    'eviews-prg',
    new (class implements vscode.HoverProvider {
      provideHover(
        _document: vscode.TextDocument,
        _position: vscode.Position,
        _token: vscode.CancellationToken
      ): vscode.ProviderResult<vscode.Hover> {
        // const range = _document.getWordRangeAtPosition(_position, /[!%@]?[A-Za-z_]\w*/i);
        let range = _document.getWordRangeAtPosition(_position, /[!%@]?([a-zA-Z_]\w*|\{[%!][a-zA-Z_]\w*\})+/i);
        if(range!==undefined) {
          const word = _document.getText(range).toLowerCase();
          const dottedRange = _document.getWordRangeAtPosition(range.start, /[!%@]?(?:[a-zA-Z_]\w*|\{[%][a-zA-Z_]\w*\})+\./i)
          console.log(`EView Lang: word at cursor ${word}`);
          if(word.length>0 && dottedRange!=undefined) { //Trigger for method completion is either a . or beginning of a word after a .
            let obj = _document.getText(dottedRange); //Extract the parent object name
            obj = obj.slice(0,obj.length-1).toLowerCase();
            const file = parserCollection.files[_document.uri.toString()];
            const symbol = file.getSymbol(parserCollection, obj, _position.line, true);
            if(symbol) {
              if(symbol.object instanceof ev.ParsedSub) {
                return;
              }
              else if(symbol.object instanceof String || typeof(symbol.object)==='string') {
                return;
              } else { //Variable
                const type = symbol.object.type.toLowerCase();
                const capType = type[0].toUpperCase()+type.slice(1);
                if(capType in eviewsGroups) {
                  if(word in eviewsGroups[capType]) {
                    const info = eviewsGroups[capType][word];
                    const desc = `${capType} method ${word}`+'\n\n'+info['description'];
                    const usage = info['usage'];
                    const contents = new vscode.MarkdownString(`${capType}: ${word}\n\nUsage: ${usage}\n\n${desc}\n\nEviews help: [${word}](${docUri(info)})`);
                    contents.isTrusted = true;
                    return new vscode.Hover(contents);
                  }
                }  
              }
            }
          }
          for(let concept of ['Programming','Commands','Element Information','Functions','Operators','General Information','Basic Workfile Functions','Dated Workfile Information','Panel Workfile Functions']) {
            if(word in eviewsGroups[concept]) {
              const info = eviewsGroups[concept][word];
              const desc = info.longDescription? info.description+'\n\n'+info.longDescription : info.description;
              const contents = new vscode.MarkdownString(`${concept}: ${word}\n\nUsage: ${info.usage}\n\n${desc}\n\nEviews help: [${word}](${docUri(info)})`);  
              contents.isTrusted = true;
              return new vscode.Hover(contents);
            }
          }
          const file = parserCollection.files[_document.uri.toString()];
          const symbol = file.getSymbol(parserCollection, word, _document.lineAt(_position).lineNumber, true);
          if(symbol) {
            if(symbol.object instanceof ev.ParsedSub) {
              const name = symbol.object.name;
              const type = 'subroutine';
              const scope = symbol.scope;
              const capType = type[0].toUpperCase()+type.slice(1);
              const concept = 'Programming';
              if(type in eviewsGroups[concept]) {
                const info = eviewsGroups[concept][type];
                const desc = info.description;
                const fileInfo = file.file.toString()===symbol.file.toString()? '':`\n\n${symbol.file.toString()}`;
                const contents = new vscode.MarkdownString(`${capType} ${word} (${scope})${fileInfo}\n\n${capType}: ${desc}\n\nEviews help: [${capType}](${docUri(info)})`);  
                contents.isTrusted = true;
                return new vscode.Hover(contents);
              }
            }
            else if(symbol.object instanceof String || typeof(symbol.object)==='string') {

            }
            else { //Variable
              const name = symbol.object.name;
              const type = symbol.object.type.toLowerCase();
              const scope = symbol.scope;
              const capType = type[0].toUpperCase()+type.slice(1);
              const concept = 'Commands';
              if(`[${capType}]` in eviewsGroups[capType]) {
                const info = eviewsGroups[capType][`[${capType}]`];
                const desc = info.description;
                const contents = new vscode.MarkdownString(`${capType} ${word} (${scope})\n\n${desc}\n\nEviews help: [${capType}](${docUri(info)})`);  
                contents.isTrusted = true;
                return new vscode.Hover(contents);
              }
            }
          }
        } else {
        // To enable command URIs in Markdown content, you must set the `isTrusted` flag.
        // When creating trusted Markdown string, make sure to properly sanitize all the
        // input content so that only expected command URIs can be executed
          const commentCommandUri = vscode.Uri.parse(`command:editor.action.addCommentLine`);
          const contents = new vscode.MarkdownString(`[Add comment](${commentCommandUri})`);
          contents.isTrusted = true;
          console.log(`EVIews Lang hover: ${contents}`);
  
          return new vscode.Hover(contents);

        }

      }
    })()
  );
  context.subscriptions.push(cprov, hprov);
}

  // This method is called when your extension is deactivated
export function deactivate() {
  parserCollection.push('#END');
}