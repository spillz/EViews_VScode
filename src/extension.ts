import { CancellationToken, Position, TextDocument, Uri } from 'vscode';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as ev from './eviews_parser';
import { describe } from 'node:test';

export const Exec_In_Terminal_Icon = 'eviews.execInTerminal-icon';


// export interface ICommandNameArgumentTypeMapping extends ICommandNameWithoutArgumentTypeMapping {
//     ['vscode.openWith']: [Uri, string];
//     [Exec_In_Terminal_Icon]: [Uri, string];
// }

type Snip = {
  [id:string]: {prefix:string, body:string[], usage:string, description:string}
}

const program_snippets:{[keyword:string]:Snip} = {
  "for": {
    "For Loop Scalar": {
      "prefix": "for#int",
      "body": ["for ${1:!var} = ${2:!start} to ${3:!end} ${4:[step !n]}", "\t$0", "next"],
      "usage": "for !var = !start to !end ...",
      "description": "Loop over values in a range."
    },
    "For Loop String": {
      "prefix": "for#string",
      "body": ["for ${1:%s} ${2:{%space_sep_string\\}}", "\t$0", "next"],
      "usage": "for %s {%space_sep_string} ...",
      "description": "Loop over string values in a string list."
    },
  },
  "if": {
    "If": {
      "prefix": "if",
      "body": ["if ${1:condition} then", "\t$0", "endif"],
      "usage": "if <condition> then ...",
      "description": "An if block."
    },
    "If Else": {
      "prefix": "if#else",
      "body": ["if ${1:condition} then", "\t$2", "else", "\t$0", "endif"],
      "usage": "if <condition> then... else ...",
      "description": "An if else block."
    },
  },
  "else": {
    "Else": {
      "prefix": "else",
      "body": ["else"],
      "usage": "else",
      "description": "Else part of if statement."
    },  
  },
  "endif": {
    "Endif": {
      "prefix": "endif",
      "body": ["endif"],
      "usage": "endif",
      "description": "End of if statement."
    },  
  },
  "while": {
    "While": {
      "prefix": "while",
      "body": ["while ${1:condition}", "\t$0", "wend"],
      "usage": "while <condition> ...",
      "description": "A while loop."
    },  
  },
  "wend": {
    "Wend": {
      "prefix": "wend",
      "body": ["wend"],
      "usage": "wend",
      "description": "End of while loop."
    },  
  },
  "subroutine": {
    "Subroutine": {
      "prefix": "subroutine",
      "body": ["subroutine ${1:sub_name}${2:(type1 arg1, type2 arg2, ...)}", "\t$0", "endsub"],
      "usage": "subroutine <sub_name>[(<arg1>, <arg2>, ...)] ...",
      "description": "Subroutine definition."
    },  
  },
  "endsub": {
    "Subroutine": {
      "prefix": "ensub",
      "body": ["endsub"],
      "usage": "endsub",
      "description": "Subroutine end."
    },  
  },
  "call": {
    "Call": {
      "prefix": "call",
      "body": ["call ${1:sub_name}"],
      "usage": "call <sub_name>[(<arg1>, <arg2>, ...)]",
      "description": "A subroutine call."
    }  
  }
}

type SigData = {
  call:string,
  args:Array<{label:string, description?:string}>  
}

function getParamLoc(argPart:string): number {
  let i=0;
  let argLoc = 0;
  let parenLevel = 0;
  let quoteLevel = 0;
  argPart = argPart.slice(1);
  while(i<argPart.length) {
    if(argPart[i]===',' && parenLevel===0 && quoteLevel===0) {
      argLoc++;
    }
    if(argPart[i]==="'" && quoteLevel===0) {
      return argLoc;
    }
    if(argPart[i]==='"') {
      quoteLevel = quoteLevel===0?1:0;
    }
    if(argPart[i]==='(' && quoteLevel===0) {
      parenLevel++;
    }
    if(argPart[i]===')' && quoteLevel===0) {
      parenLevel--;
    }
    if(parenLevel<0) {
      return argLoc;
    }
    i++;
  }
  return argLoc;
}

function subSigData(sub:ev.ParsedSub):SigData {
  const argPart = sub.args.map((a)=>`${a.type.toLowerCase()} ${a.name.toLowerCase()}`).join(', ');
  const call = sub.args.length>0? `call ${sub.name.toLowerCase()}(${argPart})`:`call ${sub.name.toLowerCase()}`;
  const args = sub.args.map((a)=>{return {label:a.name.toLowerCase(), description:`${a.type.toLowerCase()} ${a.name.toLowerCase()}`};})
  return {
    call: call,
    args: args,
  };
}

function usageSnippets(usage:string, kw:string):Array<[string, vscode.SnippetString]> {
  const snippets:Array<[string, vscode.SnippetString]> = [];
  for(let use of usage.split('\n')) {
    const k = use.indexOf(kw);
    if(k===undefined) continue
    let options = use.slice(k+kw.length);
    let new_use = use.slice(0,k+kw.length);
    let i = 1;
    while(true) {
      const match = options.match(/^([\s(),]*)([^\s^[^\]^(^)^,]+|\[.*?\])/);
      if(!match) break;
      options = options.slice(match[0].length);
      if(match[2][0]=='@') {
        new_use = new_use+match[0];
      } else {
        new_use = new_use+match[1]+'${'+String(i)+':'+match[2]+'}';
      }
      i++;
    }
    snippets.push([use, new vscode.SnippetString(new_use)]);
  }  
  return snippets;
}


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
      let use:string = kwjson.usage??'';
      use = use.replace(/  /g,' ');
      use = use.replace(/ \(/g,'(');
      use = use.replace(/\( /g,'(');
      use = use.replace(/ \)/g,')');
      use = use.replace(/\[ /g,'[');
      use = use.split('\n').map((u)=>u.replace(RegExp('^.*?\\.\\s*('+kwd+')'), '$1')).join('\n');
      const kwinfo: KeywordInfo = {
        usage: use,
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
      parserCollection.push(doc.uri.toString());
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
        let range = document.getWordRangeAtPosition(position, /([!%@]?(?:\{[%!][a-zA-Z_]\w*\}|[a-zA-Z_]\w*)(?:\{[%!][a-zA-Z_]\w*\}|\w*)*\.?|[!%@])/i);
        const file = parserCollection.files[document.uri.toString()];
        if(range!==undefined) {
          const linePrefix = document.lineAt(position.line).text.slice(0,range.start.character)
          const word = document.getText(range).toLowerCase();
          const line = document.lineAt(position).text;
          const dottedRange = document.getWordRangeAtPosition(range.start, /[!%@]?(?:\{[%!][a-zA-Z_]\w*\}|[a-zA-Z_]\w*)(?:\{[%!][a-zA-Z_]\w*\}|\w*)*\./i)
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
                    const info = eviewsGroups[capType][meth]
                    if(meth[0]==='[') continue; //Skip the object definition entry, it's not a method
                    if(meth[0]==='@') {
                      const ci = new vscode.CompletionItem(meth, vscode.CompletionItemKind.Method);
                      ci.documentation = `${capType} method ${meth}`+'\n\n'+info['description']+`\n\nEviews help: [${capType}](${docUri(info)})`;
                      ci.detail = eviewsGroups[capType][meth]['usage'].split('\n').join(' | ');
                      ci.range = range;
                      ci.preselect = true;
                      items.push(ci);          
                    } else {
                      for(const use of usageSnippets(eviewsGroups[capType][meth]['usage'], meth)) {
                        const ci = new vscode.CompletionItem(meth, vscode.CompletionItemKind.Method);
                        ci.documentation = `${capType} method ${meth}`+'\n\n'+info['description']+`\n\nEviews help: [${capType}](${docUri(info)})`;
                        ci.detail = use[0];
                        ci.range = range;
                        ci.insertText = use[1];
                        ci.preselect = true;
                        items.push(ci);            
                      }
                    }
                  }
                }
              }
            }
            if(items.length==0) {
              const ci = new vscode.CompletionItem('<No methods available for unknown object type>', vscode.CompletionItemKind.Method);
              items.push(ci);
            }
          } else {
            if(linePrefix.trim().length==0) {
              for(let concept of ['Programming','Commands']) { //Commands -- todo, these should only trigger at the start of a line
                for(const kw in eviewsGroups[concept]) {
                  if(kw[0]=='[') continue;
                  const info = eviewsGroups[concept][kw];
                  if(kw in program_snippets) {
                    const snips = program_snippets[kw];
                    for(const s in snips) {
                      const snipData = snips[s];
                      const ci = new vscode.CompletionItem(snipData["prefix"], vscode.CompletionItemKind.Keyword);
                      ci.documentation = snipData['description']+`\n\nEviews help: [${kw}](${docUri(info)})`;
                      ci.detail = snipData['usage'] //eviewsGroups[concept][kw]['usage'].split('\n').join(' | ');
                      ci.range = range;  
                      ci.insertText = new vscode.SnippetString(snipData['body'].join('\n'));
                      items.push(ci);
                    }
                  } else {
                    const usage = eviewsGroups[concept][kw]['usage'];
                    for(let use of usageSnippets(usage, kw)) {
                      const ci = new vscode.CompletionItem(kw, vscode.CompletionItemKind.Keyword);
                      ci.documentation = eviewsGroups[concept][kw]['description']+`\n\nEviews help: [${kw}](${docUri(info)})`;
                      ci.detail = use[0] //eviewsGroups[concept][kw]['usage'].split('\n').join(' | ');
                      ci.range = range;
                      ci.insertText = use[1];
                      items.push(ci);    
                    }  
                  }
                }
              }  
            }
            for(let concept of ['Element Information','Functions','Operators','General Information','Basic Workfile Functions','Dated Workfile Information','Panel Workfile Functions']) {
              for(const kw in eviewsGroups[concept]) {
                if(kw[0]=='[') continue;
                const info = eviewsGroups[concept][kw]
                const ci = new vscode.CompletionItem(kw, vscode.CompletionItemKind.Function);
                ci.documentation = eviewsGroups[concept][kw]['description']+`\n\nEviews help: [${kw}](${docUri(info)})`;
                ci.detail = eviewsGroups[concept][kw]['usage'].split('\n').join(' | ');
                ci.range = range;
                items.push(ci);
              }
            }
            const symbols = file.getAllSymbols(parserCollection, position.line, true);
            for(const symbol of symbols) {
              if(symbol.object instanceof ev.ParsedSub) {
                if(linePrefix.trim().toLowerCase()!=='call') continue;
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
                  ci.preselect = true;
                  items.push(ci);
                }
              }
              else if(symbol.object instanceof String || typeof(symbol.object)==='string') {
  
              }
              else { //Variable
                if(linePrefix.trim().toLowerCase()==='call') continue;
                const name = symbol.object.name.toLowerCase();
                const type = symbol.object.type.toLowerCase();
                const scope = symbol.scope;
                const capType = type[0].toUpperCase()+type.slice(1);
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
    context.subscriptions.push(
      vscode.languages.registerSignatureHelpProvider(
        'eviews-prg',
        {
          provideSignatureHelp(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.SignatureHelpContext) {
            const range = document.getWordRangeAtPosition(position, /(call)?\s*((?:\{[%!][a-zA-Z_]\w*\}|[a-zA-Z_]\w*)(?:\{[%!][a-zA-Z_]\w*\}|\w*)*\.)?([@]?[A-Z_]\w*)([(](?:[^(^)]*|\(.*\))*)/i);
            if(range===undefined) return;
            const fullFuncText = document.getText(range);
            const funcText = document.getText(new vscode.Range(range.start, position));
            const funcMatch = funcText.match(/(call)?\s*((?:\{[%!][a-zA-Z_]\w*\}|[a-zA-Z_]\w*)(?:\{[%!][a-zA-Z_]\w*\}|\w*)*\.)?([@]?[A-Z_]\w*)([(](?:[^(^)]*|\(.*\))*)$/i);
            if (funcMatch) {
              const file = parserCollection.files[document.uri.toString()];
              let callData:KeywordInfo|undefined = undefined;
              let callName;
              let obj:string;
              let capType:string;
              let concept: string;
              let argPart: string = funcMatch[4];
              if(context.activeSignatureHelp!==undefined) {
                if(context.triggerCharacter===',') {
                  context.activeSignatureHelp.activeParameter = getParamLoc(argPart);
                  return context.activeSignatureHelp;
                }
              }
              const signatureHelp = new vscode.SignatureHelp();
              signatureHelp.activeParameter = getParamLoc(argPart);
              if(funcMatch[1]!==undefined) { //subroutine call
                callName = funcMatch[3].toLowerCase();
                const symbol = file.getSymbol(parserCollection, callName, position.line, true);
                if(symbol!==undefined && symbol.object instanceof ev.ParsedSub) {
                  const sigData = subSigData(symbol.object);  
                  const sig = new vscode.SignatureInformation(sigData.call, 'Subroutine');
                  for(const arg of sigData.args) {
                    sig.parameters.push(new vscode.ParameterInformation(arg.label, arg.description));
                  }
                  signatureHelp.signatures.push(sig);
                  return signatureHelp;
                }
              }
              if(funcMatch[2]!==undefined) { //method call
                obj = funcMatch[2].slice(0, funcMatch[1].length-1);
                callName = funcMatch[3].toLowerCase();
                concept = `${obj} method`;
                const symbol = file.getSymbol(parserCollection, obj, position.line, true);
                if(symbol) {
                  if(!(symbol.object instanceof ev.ParsedSub) && !(symbol.object instanceof String) && !(typeof(symbol.object)==='string')) {
                    const type = symbol.object.type.toLowerCase();
                    capType = type[0].toUpperCase()+type.slice(1);
                    if(capType in eviewsGroups) {
                      if(callName in eviewsGroups[capType]) {
                        callData = eviewsGroups[capType][callName];
                      }
                    }  
                  }
                }
              }
              else { //function call or a command
                const callName = funcMatch[3].toLowerCase();
                const argPart = funcMatch[4];
                for(concept of ['Programming','Commands','Element Information','Functions','Operators','General Information','Basic Workfile Functions','Dated Workfile Information','Panel Workfile Functions']) {
                  if(callName in eviewsGroups[concept]) {
                    callData = eviewsGroups[concept][callName];
                    break;
                  }   
                }
              }
              if(callData===undefined) return;
              const sigString = callData['usage'].trim()
              if(sigString.toUpperCase().startsWith('SYNTAX:')) {
                const sigParts = sigString.split('\n');
                if(sigParts.length>0) {
                  const sig = new vscode.SignatureInformation(sigParts[0].slice(7).trim(), callData.description)
                  const argMatch = sigString.match(/\((.*)\)/i)
                  if(argMatch) {
                    let i=1;
                    for(let arg of argMatch[1].split(',')) {
                      arg = arg.replace('[','').replace(']','').trim();
                      const pi = i<sigParts.length && sigParts[i].match(RegExp(arg,'i'))?
                        new vscode.ParameterInformation(arg.trim(),sigParts[i].trim()):
                        new vscode.ParameterInformation(arg.trim());
                      sig.parameters.push(pi);
                      ++i;
                    }
                  }
                  signatureHelp.signatures.push(sig);
                }  
              }
              else if(sigString.split('\n').length==1) {
                const sig = new vscode.SignatureInformation(sigString, callData.description)
                const argMatch = sigString.match(/\(.*\)/i)
                if(argMatch) {
                  for(let arg of argMatch[0].split(',')) {
                    arg = arg.replace('[','').replace(']','').trim();
                    sig.parameters.push(new vscode.ParameterInformation(arg.trim()))
                  }  
                }
                signatureHelp.signatures.push(sig);
              } 
              else { //TODO: Other types of usage completions won't always fit this pattern of one variant per line
                console.log('Unparseable args', sigString)
                const sigs = sigString.split('\n');
                for(const s of sigs) {
                  const sig = new vscode.SignatureInformation(s.trim(), callData.description);
                  const argMatch = sigString.match(/\(.*\)/i)
                  if(argMatch) {
                    for(let arg of argMatch[0].split(',')) {
                      arg = arg.replace('[','').replace(']','').trim();
                      sig.parameters.push(new vscode.ParameterInformation(arg.trim()));
                    }
                  }  
                  signatureHelp.signatures.push(sig);  
                }
              }
              return signatureHelp;
            }
          }
        },
        '(', ',', ')', // trigger characters
      )
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
        let range = _document.getWordRangeAtPosition(_position, /[!%@]?(?:\{[%!][a-zA-Z_]\w*\}|[a-zA-Z_]\w*)(?:\{[%!][a-zA-Z_]\w*\}|\w*)*/i);
        if(range!==undefined) {
          const word = _document.getText(range).toLowerCase();
          const dottedRange = _document.getWordRangeAtPosition(range.start, /[!%@]?(?:\{[%!][a-zA-Z_]\w*\}|[a-zA-Z_]\w*)(?:\{[%!][a-zA-Z_]\w*\}|\w*)*\./i)
          console.log(`EView Lang: word at cursor ${word}`);
          if(word.length>0 && dottedRange!=undefined) { //Trigger for method info hover is two adjoining words separated by a . -- todo: don't hover if the word to the left starts with @
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
                    const header = `${capType} method ${word}`;
                    const desc = info['description'];
                    const usage = info['usage'];
                    const contents = new vscode.MarkdownString(`${header}\n\nUsage: ${usage}\n\n${desc}\n\nEviews help: [${word}](${docUri(info)})`);
                    contents.isTrusted = true;
                    return new vscode.Hover(contents);
                  }
                }  
              }
            }
            return new vscode.Hover(new vscode.MarkdownString(`Unknown method of unknown object ${obj}`));
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
          const symbol = file.getSymbol(parserCollection, word, _position.line, true);
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
        } 
        // else {
        // // To enable command URIs in Markdown content, you must set the `isTrusted` flag.
        // // When creating trusted Markdown string, make sure to properly sanitize all the
        // // input content so that only expected command URIs can be executed
        //   const commentCommandUri = vscode.Uri.parse(`command:editor.action.addCommentLine`);
        //   const contents = new vscode.MarkdownString(`[Add comment](${commentCommandUri})`);
        //   contents.isTrusted = true;
        //   console.log(`EVIews Lang hover: ${contents}`);
  
        //   return new vscode.Hover(contents);

        // }

      }
    })()
  );
  context.subscriptions.push(cprov, hprov);
}

  // This method is called when your extension is deactivated
export function deactivate() {
  parserCollection.push('#END');
}