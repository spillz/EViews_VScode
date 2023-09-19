import { CancellationToken, Position, TextDocument, Uri } from 'vscode';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as ev from './eviews_parser';

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
      "body": ["call "], // ${1:sub_name}
      "usage": "call <sub_name>[(<arg1>, <arg2>, ...)]",
      "description": "A subroutine call."
    }  
  }
}

type SigData = {
  call:string,
  args:Array<{label:string, description?:string}>  
}

type LineSigData = {funcPart?:string, argPart?:string, argPos?:number, obj?:string, sub?:string}
function getLineSigData(line:string): LineSigData|undefined {
  let i=0;
  let parenLevel = 0;
  let quoteLevel = 0;
  let parenLoc = [];
  while(i<line.length) {
    if(line[i]==="'" && quoteLevel===0) {
      return;
    }
    if(line[i]==='"') {
      quoteLevel = quoteLevel===0? 1:0;
    }
    if(line[i]==='(' && quoteLevel===0) {
      parenLevel++;
      parenLoc.push(i);
    }
    if(line[i]===')' && quoteLevel===0) {
      parenLevel--;
      if(parenLoc.length>0) {
        parenLoc.pop();
      }
      else {
        return;
      }
    }
    i++;
  }
  if(parenLoc.length===0) { //quoteLevel===1 || 
    return;
  }
  const result:LineSigData = {};
  let argStart = parenLoc[parenLoc.length-1];
  const funcMatch = line.slice(0, argStart).match(/[@]?[A-Z]\w*$/i);
  if(!funcMatch) return {};
  result.funcPart = funcMatch[0];
  result.argPart = line.slice(argStart);
  result.argPos = getParamLoc(result.argPart);
  const funcStart = argStart-result.funcPart.length
  const objMatch = line.slice(0, funcStart).match(/([%!]?(?:[A-Z]\w*|\{[%!][A-Z]\w*\})+)\.$/i)
  if(objMatch) {
    result.obj = objMatch[1];
  } else {
    const subMatch = line.slice(0, funcStart).match(/(call)\s+$/i)
    if(subMatch) result.sub = subMatch[1];  
  }
  return result;
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
  const argPart = sub.args.map((a)=>`${a.type.toLowerCase()} ${a.name}`).join(', ');
  const call = sub.args.length>0? `call ${sub.name}(${argPart})`:`call ${sub.name}`;
  const args = sub.args.map((a)=>{return {label:a.name, description:`${a.name} (${a.type.toLowerCase()}): `+((a.lookupName in sub.docString.args)?sub.docString.args[a.lookupName]:'_no description_')};});
  return {
    call: call,
    args: args,
  };
}

function subDocString(sub:ev.ParsedSub):string {
  let md = sub.docString.body!==''? sub.docString.body:'_No description_'
  let args = ''
  for(const a of sub.args) {
    args += `\n\n * ${a.name} (${a.type.toLowerCase()}): `+((a.lookupName in sub.docString.args)?sub.docString.args[a.lookupName]:'_no description_');
  }
  if(args.length>0) {
    md += '\n\nArguments:'+args
  }
  return md
}


function usageSnippets(usage:string, kw:string):Array<[string, vscode.SnippetString]> {
  const snippets:Array<[string, vscode.SnippetString]> = [];
  for(let use of usage.split('\n')) {
    const k = use.indexOf(kw);
    if(k===undefined) continue
    let options = use.slice(k+kw.length);
    let new_use = use.slice(0,k+kw.length);
    let i = 0;
    while(true) {
      ++i;
      let match = options.match(/^(\s*\(\s*options\s*\))/i); //single parens enclosed option e.g., "command(options)" -- select outside the parens
      if(match) {
        options = options.slice(match[0].length);
        new_use = new_use+'${'+String(i)+':'+match[0]+'}';
        continue
      }
      match = options.match(/^(\s*)\((.*?)\)/i) //all other options in parens -- create a group inside the parens (i.e., assumed not optional)
      if(match) {
        options = options.slice(match[0].length);
        new_use = new_use+match[1]+'(${'+String(i)+':'+match[2]+'})';
        continue
      }
      match = options.match(/^(\s+[^\s^[^\],]+|\s+\[.*?\])/); //all other command line args are outside of params but can be optional denoted by enclosed square brackets
      if(!match || match[0].length===0) break;
      options = options.slice(match[0].length);
      if(match[1][0]=='@') {
        new_use = new_use+match[0]; //@keywords are assumed to be required part of the command unless enclosed in [ ]
      } else {
        new_use = new_use+'${'+String(i)+':'+match[1]+'}'; //other command parts to be filled out including optional bits enclosed in []
      }
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
  const end = kwi.anchor===''?kwi.uri+'.html':kwi.uri+'.html%23'+kwi.anchor;
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
      use = use.split('\n').map((u)=>u.replace(RegExp('^.*?('+kwd+')'), '$1')).join('\n'); //strips text before keywords. Old regexp version: RegExp('^.*?\\.\\s*('+kwd+')')
      if(use.length===0) use = kwd;
      const kwinfo: KeywordInfo = {
        usage: use,
        description: kwjson.description??'',
        longDescription: kwjson.long_description??'',
        uri: kwjson.uri??'',
        anchor: kwjson.anchor??'',
      }
      eviewsGroups[grp][kwd] = kwinfo;
    }
  };

  let disposable;
  
  disposable = vscode.commands.registerCommand('eviews.setEViewsPath', () => {
    if(process.platform!=='win32') {
      vscode.window.showErrorMessage('EViews launch only supported on Windows');
      return;
    }
    let defaultPath:string = vscode.workspace.getConfiguration('eviews-language-extension').get('eviews-path')!;
    if(!defaultPath) {
      defaultPath = 'C:\\Program Files (x86)\\';
    }
    const files = vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: 'Select the EViews executable',
      defaultUri: vscode.Uri.file(defaultPath),
      filters: {
        'Eviews exectuable': ['exe']
      }
    }).then((uris) => {
      if(uris && uris.length==1) {
        const uri = uris[0];
        if(path.extname(uri.fsPath)==='.exe') {
          vscode.workspace.getConfiguration('eviews-language-extension').update('eviews-path', uri.fsPath);
        }
      }
    });
  });


  disposable = vscode.commands.registerCommand('eviews.runEViews', () => {
    let eviewsPrg:string = vscode.workspace.getConfiguration('eviews-language-extension').get('eviews-path')!;
    if(!eviewsPrg) {
      if(process.platform!=='win32') {
        vscode.window.showErrorMessage('EViews launch only supported on Windows');
        return;
      }
      const files = vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Select the EViews executable',
        defaultUri: vscode.Uri.file('C:\\Program Files (x86)\\'),
        filters: {
          'Eviews exectuable': ['exe']
        }
      }).then((uris) => {
        if(uris && uris.length==1) {
          const uri = uris[0];
          if(path.extname(uri.fsPath)==='.exe') {
            vscode.workspace.getConfiguration('eviews-language-extension').update('eviews-path', uri.fsPath, vscode.ConfigurationTarget.Global);
            vscode.commands.executeCommand("eviews.runEViews");
          }
        }
      });
      return;
    }
    const editor = vscode.window.activeTextEditor;
    if(!editor || editor.document.languageId!=='eviews-prg') return;
    const eviewsExec = new vscode.ProcessExecution(eviewsPrg, [editor.document.uri.fsPath]);
    const _task = new vscode.Task(
      { type: 'eviewLaunchGroup' }, 
      vscode.TaskScope.Global,
      'eviews.launch.activeEditor', // Task name
      'eviewsLaunchGroup', // Task source
      eviewsExec // The ProcessExecution object
    );
  vscode.tasks.executeTask(_task);
  });

  context.subscriptions.push(disposable);

  const openDocs = vscode.workspace.textDocuments.filter((doc)=>doc.languageId==='eviews-prg');
  for(let doc of openDocs) {
    parserCollection.push(doc.uri.toString());
  }

  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument((doc)=> {
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
    {
      provideCompletionItems(document: TextDocument, position: Position, token: CancellationToken, context: vscode.CompletionContext): 
                    vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList<vscode.CompletionItem>> {
        const items:vscode.CompletionItem[] = [];
        let range = document.getWordRangeAtPosition(position, /([!%@]?(?:\{[%!][a-zA-Z_]\w*\}|[a-zA-Z_]\w*)(?:\{[%!][a-zA-Z_]\w*\}|\w*)*\.?|[!%@])/i);
        const file = parserCollection.files[document.uri.toString()];
        const lineStart = new vscode.Position(position.line,0);
        let word:string;
        let dottedMatch:RegExpMatchArray|null;
        let subCallMatch:RegExpMatchArray|null;
        if(range!==undefined) {
          word = document.getText(range);
          dottedMatch = document.getText(new vscode.Range(lineStart, range.start))
                              .match(/[!%@]?(?:\{[%!][a-zA-Z_]\w*\}|[a-zA-Z_]\w*)(?:\{[%!][a-zA-Z_]\w*\}|\w*)*\.$/i);
          subCallMatch = dottedMatch===null? //Subroutine call match should be non-null if cursor is after a "call " but before an opening parens "(" -- we will give hints for known subs if this is not null
                              document.getText(new vscode.Range(lineStart, range.start))
                                      .match(/call\s+(?!\w+\()/i): 
                              null;
        } else {
          range = new vscode.Range(position, position);
          subCallMatch = document.getText(new vscode.Range(lineStart, position)).match(/call\s+/i);
          if(subCallMatch===null) return;
          dottedMatch = null;
          word = '';
        }
        const prefixPos = new vscode.Position(lineStart.line, 
                    (dottedMatch!==null? range.start.character - dottedMatch[0].length:
                    subCallMatch!==null? subCallMatch.index! + subCallMatch[0].length:
                    range.start.character)
        );
        const linePrefix = document.getText(new vscode.Range(lineStart, prefixPos));
        if(word.endsWith('.') || !word.endsWith('.') && word.length>0 && dottedMatch!==null) {
          //Trigger for method completion is either a . or beginning of a word after a .
          if(word.endsWith('.')) range = document.getWordRangeAtPosition(position); //Reposition the insertion range to be after the "."
          let obj = word.endsWith('.')? word : dottedMatch![0]; //Extract the parent object name
          obj = obj.slice(0,obj.length-1);//.toLowerCase();
          if(obj[0]==='!' || obj[0]==='%') return;
          const symbol = file.getSymbol(parserCollection, obj, position.line, true, true);
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
                  if(meth[0]==='@') { //object properties
                    const ci = new vscode.CompletionItem(meth, vscode.CompletionItemKind.Method);
                    ci.documentation = new vscode.MarkdownString(`${capType} method ${meth}`+'\n\n'+info['description']+`\n\nEviews help: [${meth}](${docUri(info)})`);
                    ci.documentation.isTrusted = true;
                    ci.detail = eviewsGroups[capType][meth]['usage'].split('\n').join(' | ');
                    ci.range = range;
                    ci.preselect = true;
                    items.push(ci);          
                  } else { //object commands
                    const usage = eviewsGroups[capType][meth]['usage'];
                    for(const use of usageSnippets(usage, meth)) {
                      if(use[0].trim().length>0) {
                        const ci = new vscode.CompletionItem(meth, vscode.CompletionItemKind.Method);
                        ci.documentation = new vscode.MarkdownString(`${capType} method ${meth}`+'\n\n'+info['description']+`\n\nEviews help: [${meth}](${docUri(info)})`);
                        ci.documentation.isTrusted = true;
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
          }
          if(items.length==0) {
            const ci = new vscode.CompletionItem('<No methods available for unknown object type>', vscode.CompletionItemKind.Method);
            items.push(ci);
          }
        } else {
          if(linePrefix.trim().length==0 && subCallMatch===null) {
            //Programming steps and commands -- all appear at the start of a line (we handle CALL separately)
            for(let concept of ['Programming','Commands']) { //Commands -- todo, these should only trigger at the start of a line
              for(const kw in eviewsGroups[concept]) {
                if(kw[0]=='[') continue;
                const info = eviewsGroups[concept][kw];
                if(kw in program_snippets) {
                  const snips = program_snippets[kw];
                  for(const s in snips) {
                    const snipData = snips[s];
                    const ci = new vscode.CompletionItem(snipData["prefix"], vscode.CompletionItemKind.Keyword);
                    ci.documentation = new vscode.MarkdownString(snipData['description']+`\n\nEviews help: [${kw}](${docUri(info)})`);
                    ci.documentation.isTrusted = true;
                    ci.detail = snipData['usage'] //eviewsGroups[concept][kw]['usage'].split('\n').join(' | ');
                    ci.range = range;  
                    ci.insertText = new vscode.SnippetString(snipData['body'].join('\n'));
                    items.push(ci);
                  }
                } else {
                  const usage = eviewsGroups[concept][kw]['usage'];
                  for(let use of usageSnippets(usage, kw)) {
                    const ci = new vscode.CompletionItem(kw, vscode.CompletionItemKind.Keyword);
                    ci.documentation = new vscode.MarkdownString(eviewsGroups[concept][kw]['description']+`\n\nEviews help: [${kw}](${docUri(info)})`);
                    ci.documentation.isTrusted = true;
                    ci.detail = use[0] //eviewsGroups[concept][kw]['usage'].split('\n').join(' | ');
                    ci.range = range;
                    ci.insertText = use[1];
                    items.push(ci);    
                  }  
                }
              }
            }  
          }
          if(subCallMatch===null) {
            //Functions -- we'll show anywhere except after a call statement
            for(let concept of ['Element Information','Functions','Operators','General Information','Basic Workfile Functions','Dated Workfile Information','Panel Workfile Functions']) {
              for(const kw in eviewsGroups[concept]) {
                if(kw[0]=='[') continue;
                const info = eviewsGroups[concept][kw]
                const ci = new vscode.CompletionItem(kw, vscode.CompletionItemKind.Function);
                ci.documentation = new vscode.MarkdownString(eviewsGroups[concept][kw]['description']+`\n\nEviews help: [${kw}](${docUri(info)})`);
                ci.documentation.isTrusted = true;
                ci.detail = eviewsGroups[concept][kw]['usage'].split('\n').join(' | ');
                ci.range = range;
                items.push(ci);
              }
            }
          }
          const symbols = file.getAllSymbols(parserCollection, position.line, true, true);
          if(subCallMatch!==null) {
            //show user-defined subroutines after a call statement
            for(const symbol of symbols) {
              if(symbol.object instanceof ev.ParsedSub) {
                const name = symbol.object.name;//.toLowerCase();
                const type = 'subroutine';
                const scope = symbol.scope;
                const capType = type[0].toUpperCase()+type.slice(1);
                const concept = 'Programming';
                if(type in eviewsGroups[concept]) {
                  const info = eviewsGroups[concept][type];
                  const ci = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
                  const fileInfo = file.file.toString()===symbol.file.toString()? '':`\n\nDefined in [${path.basename(symbol.file.fsPath)}:${symbol.object.start+1}](${symbol.file.toString()}#L${symbol.object.start+1})`;
                  ci.documentation = new vscode.MarkdownString(`${capType}: ${info.description}`+fileInfo);
                  ci.documentation.isTrusted = true;
                  ci.detail = `${capType} ${name} (${scope})`;
                  ci.range = range;
                  ci.preselect = true;
                  items.push(ci);
                }
              }
            }
          } else {
            //otherwise show user-defined objects and variables
            for(const symbol of symbols) {
              if(symbol.object instanceof String || typeof(symbol.object)==='string' || symbol.object instanceof ev.ParsedSub) continue;
              const name = symbol.object.name;
              const type = symbol.object.type.toLowerCase();
              const scope = symbol.scope;
              const capType = type[0].toUpperCase()+type.slice(1);
              if(`[${capType}]` in eviewsGroups[capType]) {
                const info = eviewsGroups[capType][`[${capType}]`];
                const ci = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
                const fileInfo = file.file.toString()===symbol.file.toString()? '':`\n\nDefined in [${path.basename(symbol.file.fsPath)}](${symbol.file.toString()})`;
                ci.documentation = new vscode.MarkdownString(`${info.description}`+fileInfo);
                ci.documentation.isTrusted = true;
                ci.detail = `${capType} ${name} (${scope})`;
                ci.range = range;
                items.push(ci);
              }
            }  
          }
        }
        return items;
      },
      resolveCompletionItem(item: vscode.CompletionItem, token: CancellationToken): vscode.ProviderResult<vscode.CompletionItem> {
        return item;
      }
    }, 
    '@',
    '.',
    '%',
    '!',
  );
  const sprov = vscode.languages.registerSignatureHelpProvider(
    'eviews-prg',
    {
      provideSignatureHelp(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.SignatureHelpContext) {
        const lineStart = new vscode.Position(position.line,0);
        const line = document.getText(new vscode.Range(lineStart, position))
        const lineSigData = getLineSigData(line);
        if(lineSigData===undefined) return;
        const file = parserCollection.files[document.uri.toString()];
        if(lineSigData.argPos===undefined || lineSigData.funcPart===undefined) return;
        if(context.activeSignatureHelp!==undefined) {
          if(context.triggerCharacter===',') {
            context.activeSignatureHelp.activeParameter = lineSigData.argPos;
            return context.activeSignatureHelp;
          }
        }
        let callName:string = lineSigData.funcPart;;
        let callData:KeywordInfo|undefined = undefined;
        let capType:string;
        let concept: string;
        const signatureHelp = new vscode.SignatureHelp();
        signatureHelp.activeParameter = lineSigData.argPos;
        if(lineSigData.sub) { //subroutine call
          const symbol = file.getSymbol(parserCollection, callName, position.line, true, true);
          if(symbol!==undefined && symbol.object instanceof ev.ParsedSub) {
            const sigData = subSigData(symbol.object);  
            const sig = new vscode.SignatureInformation(sigData.call, `Subroutine ${symbol.object.name}`);
            for(const arg of sigData.args) {
              sig.parameters.push(new vscode.ParameterInformation(arg.label, arg.description));
            }
            signatureHelp.signatures.push(sig);
            return signatureHelp;
          }
        }
        if(lineSigData.obj) { //object property/method call
          const obj = lineSigData.obj;
          if(obj[0]==='!' || obj[0]==='%') return;
          concept = `${obj} property`;
          const symbol = file.getSymbol(parserCollection, obj, position.line, true, true);
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
    },
    '(', ',', ')', // trigger characters
  )
  const hprov = vscode.languages.registerHoverProvider(
    'eviews-prg',
    {
      provideHover(
        document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Hover> {
        let range = document.getWordRangeAtPosition(position, /[!%@]?(?:\{[%!][a-zA-Z_]\w*\}|[a-zA-Z_]\w*)(?:\{[%!][a-zA-Z_]\w*\}|\w*)*/i);
        if(range!==undefined) {
          const wordAsTyped = document.getText(range); 
          const word = wordAsTyped.toLowerCase();
          const lineStart = new vscode.Position(range.start.line,0);
          const dottedMatch = document.getText(new vscode.Range(lineStart, range.start))
                              .match(/[!%@]?(?:\{[%!][a-zA-Z_]\w*\}|[a-zA-Z_]\w*)(?:\{[%!][a-zA-Z_]\w*\}|\w*)*\.$/i);
          if(word.length>0 && dottedMatch) { //Trigger for method info hover is two adjoining words separated by a . -- todo: don't hover if the word to the left starts with @
            let obj = dottedMatch[0]; //Extract the parent object name
            obj = obj.slice(0,obj.length-1);//.toLowerCase();
            if(obj[0]==='!' || obj[0]==='%') return new vscode.Hover(`Invalid "." operation on program variable ${obj}`);
            const file = parserCollection.files[document.uri.toString()];
            const symbol = file.getSymbol(parserCollection, obj, position.line, true, true);
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
          const file = parserCollection.files[document.uri.toString()];
          const symbol = file.getSymbol(parserCollection, word, position.line, true, true);
          if(symbol) {
            if(symbol.object instanceof ev.ParsedSub) {
              const line = document.getText(new vscode.Range(lineStart,range.start)).trim().toUpperCase();
              if(line.startsWith('CALL') || line.startsWith('SUBROUTINE')) {
                const name = symbol.object.name;
                const type = 'subroutine';
                const scope = symbol.scope;
                const capType = type[0].toUpperCase()+type.slice(1);
                const concept = 'Programming';
                if(type in eviewsGroups[concept]) {
                  const info = eviewsGroups[concept][type];
                  const desc = info.description;
                  const fileInfo = file.file.toString()===symbol.file.toString()? `\n\nDefined on [line ${symbol.object.start+1}](${symbol.file.toString()}#L${symbol.object.start+1})`:
                    `\n\nDefined in [${path.basename(symbol.file.fsPath)}:${symbol.object.start+1}](${symbol.file.toString()}#L${symbol.object.start+1})`;
                  const sigData = subSigData(symbol.object);
                  const docString = subDocString(symbol.object);
                  const contents = new vscode.MarkdownString(`${capType} ${sigData.call} (${scope})${fileInfo}\n\n${docString}\n\n---\n\n${capType}: ${desc}\n\nEviews help: [${capType}](${docUri(info)})`);  
                  contents.isTrusted = true;
                  return new vscode.Hover(contents);
                }  
              }
            }
            else if(symbol.object instanceof String || typeof(symbol.object)==='string') {

            }
            else { //Variable
              const line = document.getText(new vscode.Range(lineStart,range.start)).trim().toUpperCase();
              const lineEnd = document.getText(new vscode.Range(range.end, document.lineAt(range.end.line).range.end)).trim().toUpperCase();
              //show user defined symbols for program vars, words after the first on the line, dot operations, or assignments (with optional params)
              if(word[0]==='%'||word[0]==='!'||line.match(/^[!%]?[A-Za-z]/)||lineEnd.match(/^(:?\(.*?\))?(\.|\s*=)/)) { 
                const name = symbol.object.name;
                const type = symbol.object.type.toLowerCase();
                const scope = symbol.scope;
                const capType = type[0].toUpperCase()+type.slice(1);
                const concept = 'Commands';
                if(`[${capType}]` in eviewsGroups[capType]) {
                  const info = eviewsGroups[capType][`[${capType}]`];
                  const desc = info.description;
                  const fileInfo = file.file.toString()===symbol.file.toString()? `\n\nFirst defined on [line ${symbol.object.line+1}](${symbol.file.toString()}#L${symbol.object.line+1})`:
                    `\n\nFirst defined in [${path.basename(symbol.file.fsPath)}:${symbol.object.line+1}](${symbol.file.toString()}#L${symbol.object.line+1})`;
                  const contents = new vscode.MarkdownString(`${capType} ${symbol.object.name} (${scope})${fileInfo}\n\n${desc}\n\nEviews help: [${capType}](${docUri(info)})`);  
                  contents.isTrusted = true;
                  return new vscode.Hover(contents);
                }  
              }
            }
          }
          let extraDocs = '';
          if(word==='include') { //Provide a link to included modules
            const file = parserCollection.files[document.uri.toString()];
            for(const inc of file.includes) {
              if(position.line===inc.line) {
                extraDocs = ` ([${path.basename(inc.uri)}](${inc.uri}))`;
                break;
              }
            }
          }
          for(let concept of ['Programming','Commands','Element Information','Functions','Operators','General Information','Basic Workfile Functions','Dated Workfile Information','Panel Workfile Functions']) {
            if(word in eviewsGroups[concept]) {
              const info = eviewsGroups[concept][word];
              const desc = info.longDescription? info.description+'\n\n'+info.longDescription : info.description;
              const contents = new vscode.MarkdownString(`${concept}: ${word}${extraDocs}\n\nUsage: ${info.usage}\n\n${desc}\n\nEviews help: [${word}](${docUri(info)})`);  
              contents.isTrusted = true;
              return new vscode.Hover(contents);
            }
          }
          if(word.length>0) {
            return new vscode.Hover(`Unkown name ${wordAsTyped}`);
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
    }
  );
  context.subscriptions.push(cprov, hprov, sprov);
}

  // This method is called when your extension is deactivated
export function deactivate() {
  parserCollection.push('#END');
}