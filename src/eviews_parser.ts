import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export var eviewsTypes = [
    'ALPHA', 'MODEL', 'SVECTOR', 'COEF', 'POOL', 'SYM', 'EQUATION', 'ROWVECTOR', 'SYSTEM', 
    'FACTOR', 'SAMPLE', 'TABLE', 'GEOMAP', 'SCALAR', 'TEXT', 'GRAPH', 'SERIES', 'USEROBJ', 'GROUP', 
    'SPOOL', 'VALMAP', 'LOGL', 'SSPACE', 'VAR', 'MATRIX', 'STRING', 'VECTOR'
];

export type Variable = {
    type: string,
    name: string,
}

export type CodeProblem = {
    line: number;
    message: string;
    var?: Variable;
}

export type Symbol = {
    object: Variable|string|ParsedSub,
    scope: string,
    file: vscode.Uri,
}


function v(type:string, name:string):Variable {
    return {type:type, name:name};
}

export class VariableArray extends Array<Variable> {
    has(name:string):boolean {
        return this.find((member)=>member.name===name)!==undefined;
    }
    get(name:string):Variable|undefined {
        return this.find((member)=>member.name===name);
    }
}

export class ParsedSub {
    // Container representing an EViews subroutines parsed for definitions and belonging to a file
    file: ParsedFile;
    name: string;
    start: number;
    end: number;
    processed_code: string|null;
    vars:VariableArray = new VariableArray();
    calls:Array<string> = [];
    args:VariableArray;

    constructor(file:ParsedFile, name:string, start:number ,end:number, args:VariableArray) {
        this.file = file;
        this.name = name;
        this.start = start;
        this.end = end;
        this.processed_code = null;
        this.args = args;
    }

    parse(code_lines:Array<string>) {
        let i=this.start;
        while(i+1<this.end) {
            i++;
            const line = code_lines[i];
            const lsu = line.trim().toUpperCase();
            if (lsu.startsWith('CALL')) {
                const call = lsu.slice(4).split("(")[0].trim(); //replace(' ','').replace('\t','')
                if(!this.calls.includes(call)) {
                    this.calls.push(call);
                }
                continue
            }
            const match = lsu.match(/^([%!][A-Z_]\w*)\s*=.*/);
            if (match) {
                const vname = match[1];
                if (!this.vars.has(vname) && !this.args.has(vname)) {
                    const vtype = vname[0]=='%'? 'STRING': 'SCALAR';
                    this.vars.push(v(vtype, vname))
                }
                continue
            }
            if(lsu.startsWith('FOR')) {
                const match = lsu.slice(3).match(/([%!]?[A-Z_]\w*)\s*=?/)
                if(match) {
                    const type = match[1][0]==='%'? 'STRING':
                            match[1][0]==='!'? 'SCALAR':
                            match[0][match[0].length-1]==='='?'SCALAR':
                            'STRING';
                    if(!this.vars.has(match[1]) && !this.args.has(match[1])) {
                        this.vars.push(v(type, match[1]));
                    }
                }
                continue
            }
            for(const objectName of eviewsTypes) {
                if(lsu.startsWith(objectName)) {
                    const match = lsu.slice(objectName.length).match(/^(?:\(.*\))?\s*((\{[%!][a-zA-Z_]\w*\}|[a-zA-Z_]\w*)+)/) //TODO: this will pick up objects defined by commands like vector(n) vecname{!i}_t
                    if(match) {
                        if (!this.vars.has(match[1]) && !this.args.has(match[1])) {
                            this.vars.push(v(objectName, match[1]))
                        }
                    }
                    continue
                }
            }
        }
    }

    toString() {
        let rep = `  - Subroutine ${this.name}\n`;
        if (this.args.length>0) {
            rep+='    args\n'
            for(const v of this.args.sort()) {
                rep += `    - ${v}\n`;
            }
        }
        if(this.calls.length>0) {
            rep += '    calls\n';
            for(const v of this.calls.sort()) {
                rep += `    - ${v}\n`;
            }

        }
        if(this.vars.length>0) {
            rep+='    variables defined\n'
            for(const v of this.vars.sort()) {
                rep+=`    - {v}\n`
            }
        }
        rep += '\n'
        return rep
    }
}

export class ParsedFile {
    file: vscode.Uri;
    code: vscode.TextDocument | null;
    processed_code: string[] | null;
    subroutines: ParsedSub[];
    vars: VariableArray;
    includes: string[];
    calls: string[];
    exists: boolean;
    problems: CodeProblem[];

    constructor(file: string) {
        this.file = vscode.Uri.parse(file);
        this.code = null;
        this.processed_code = null;
        this.subroutines = [];
        this.vars = new VariableArray();
        this.includes = [];
        this.calls = [];
        this.exists = true;
        this.problems = [];
    }

    getAllSymbols(collection: ParsedRoutinesCollection, line:number|null = null, followIncludes:boolean=false): Symbol[] {
        let symbols:Symbol[] = [];
        for(let s of this.subroutines) {
            if(line!=null && line>s.start && line<s.end) {
                for(const a of s.args) symbols.push({object:a, file:this.file, scope:'subroutine argument'});
            }
        }
        for (const v of this.vars) symbols.push({object:v, file:this.file, scope:'global'});
        for(let s of this.subroutines) {
            for(const v of s.vars) symbols.push({object:v, file:this.file, scope:'subroutine-defined global'});
            symbols.push({object:s, file:this.file, scope:'global'})
        }
        if(followIncludes) {
            for(let i of this.includes) {
                const pf = collection.files[i];
                const isymbols = pf.getAllSymbols(collection, null, followIncludes);
                symbols = [...symbols, ...isymbols];
            }
        }
        return symbols;
    }

    getSymbol(collection: ParsedRoutinesCollection, name:string, line:number|null = null, followIncludes:boolean=false): Symbol|undefined {
        name = name.toUpperCase();
        for(let s of this.subroutines) {
            if(line!=null && line>=s.start && line<s.end) {
                if(s.args.has(name)) {
                    return {object:s.args.get(name)!, file:this.file, scope:'subroutine argument'};
                }
            }
        }
        if(this.vars.has(name)) {
            return {object:this.vars.get(name)!, file:this.file, scope:'global'};
        }
        for(let s of this.subroutines) {
            if(s.vars.has(name)) {
                return {object:s.vars.get(name)!, file:this.file, scope:'subroutine-defined global'};
            }
            if(name == s.name) {
                return {object:s, file:this.file, scope:'global'}
            }
        }
        if(followIncludes) {
            for(let i of this.includes) {
                const pf = collection.files[i];
                const symbol = pf.getSymbol(collection, name, null, followIncludes);
                if(symbol!==undefined) {
                    return symbol;
                }
            }
        }
    }

    toString(): string {
        let rep = `Module ${this.file}\n`;
        if (this.includes.length > 0) {
            rep += '  Module includes\n';
            this.includes.sort().forEach(v => rep += `  - ${v}\n`);
        }
        if (this.calls.length > 0) {
            rep += '  Module-level calls\n';
            this.calls.sort().forEach(v => rep += `  - ${v}\n`);
        }
        if (this.vars.length > 0) {
            rep += '  Module-level variables defined\n';
            this.vars.sort().forEach(v => rep += `  - ${v}\n`);
        }
        if (this.subroutines.length > 0) {
            rep += '  Module subroutines defined\n';
            this.subroutines.forEach(v => rep += v.toString());
        }
        rep += '\n';
        return rep;
    }

    async parse(collection: ParsedRoutinesCollection) {
        console.log('STARTED PARSE ON', this.file.toString());
        //this.code = fs.readFileSync(this.file, 'utf8').split('\n');
        try {
            this.code = await vscode.workspace.openTextDocument(this.file);
            this.exists = true;
        } catch(error) {
            this.exists = false;
            return
        }
        const code = this.code.getText().split('\n');
        let i = -1;
        while (i+1 < code.length) {
            i++;
            let line = code[i];
            let lsu = line.trim().toUpperCase();
            if (lsu.startsWith('INCLUDE')) {
                console.log('INCLUDE');
                let include = lsu.slice(7).trim().replace('"','').replace('"',''); //'" \t'
                const res = path.resolve(path.dirname(this.file.fsPath), include);
                const resDisk = fs.realpathSync.native(res);
                const resFinal = path.resolve(path.dirname(this.file.fsPath), resDisk.slice(resDisk.length-include.length));
                let uri;
                try {
                    const doc = await vscode.workspace.openTextDocument(res);
                    uri = doc.uri.toString();
                } catch(error) {
                    uri = res;
                }
                // const resReal = fs.realpathSync(res);
                // const uri = vscode.Uri.file(resReal).toString();
                if (!this.includes.includes(uri)) {
                    this.includes.push(uri);
                }
                continue
            }
            if (lsu.startsWith('CALL')) {
                let call = lsu.slice(4).split('(')[0].trim(); //' \t'
                if (!this.calls.includes(call)) {
                    this.calls.push(call);
                }
                continue
            }
            let match = lsu.match(/([%!][A-Z_]\w*)[ \t]*=.*/);
            if (match) {
                const varName = match[1];
                const varType = varName[0]=='%'? 'STRING':'SCALAR';
                if (!this.vars.has(varName)) {
                    this.vars.push(v(varType, varName));
                }
                continue
            }
            if (lsu.startsWith('SUBROUTINE')) {
                let sub:string, argPart:string;
                let args:VariableArray = new VariableArray();
                [sub, argPart] = lsu.slice(10).split('(', 2);
                sub = sub.trim();
                const sargs = argPart.split(')',1)[0].split(',');
                for(let sarg of sargs) {
                    sarg = sarg.trim();
                    let argDef = sarg.match(/(\w+)\s([%!][A-Z_]\w*)/)
                    if(argDef) {
                        args.push(v(argDef[1], argDef[2])); //argDef[1] contains the type. Check it is a valid one
                    } //track error if no match
                }
                let j = i + 1;
                while (j < code.length) {
                    let lline = code[j];
                    if (lline.trim().toUpperCase().startsWith('SUBROUTINE')) {
                        this.problems.push({line:j, message:'ERROR: Illegal nested sub', var:{type:'SUB', name:sub}});
                        let ps = new ParsedSub(this, sub, i, j, args);
                        ps.parse(code);
                        this.subroutines.push(ps);
                        break;
                    }
                    if (lline.trim().toUpperCase().startsWith('ENDSUB')) {
                        let ps = new ParsedSub(this, sub, i, j, args);
                        ps.parse(code);
                        this.subroutines.push(ps);
                        break;
                    }
                    j++;
                }
                if (j === code.length) {
                    this.problems.push({line:j, message:'ERROR: Missing endsub in file', var:{type:'SUB', name:sub}});
                    let ps = new ParsedSub(this, sub, i, j, args);
                    ps.parse(code);
                    this.subroutines.push(ps);
                }
                i = j;
                continue
            }
            if(lsu.startsWith('FOR')) {
                const match = lsu.slice(3).match(/([%!]?[A-Z_]\w*)\s*=?/)
                if(match) {
                    const type = match[1][0]==='%'? 'STRING':
                            match[1][0]==='!'? 'SCALAR':
                            match[0][match[0].length-1]==='='?'SCALAR':
                            'STRING';
                    if(!this.vars.has(match[1])) {
                        this.vars.push(v(type, match[1]));
                    }
                }
                continue
            }
            for(const objectName of eviewsTypes) {
                if(lsu.startsWith(objectName)) {
                    const match = lsu.slice(objectName.length).match(/^(?:\(.*\))?\s*(([a-zA-Z_]\w*|\{[%!][a-zA-Z_]\w*\})+)/); //TODO: this will pick up commands like vector(n) vecname{!i}_t
                    if(match && !this.vars.has(match[1])) {
                        this.vars.push(v(objectName, match[1]));
                    }
                    continue
                }
            }
        }
        collection.files[this.file.toString()] = this;
        for (let include of this.includes) {
            if (!(include in collection.files)) {
                collection.push(include);
            }
        }
    }
}

export class ParsedRoutinesCollection {
    // Container representing a collection of parsed EViews files
    files: {[key: string]: ParsedFile} = {};
    queue: string[] = [];
    resolver: null|((value:string)=>void) = null;

    cancelAll() {
        this.queue = [];
    }

    cancel(file:string) {
        this.queue.filter((items)=>items!=file);
    }

    push(file:string, unique=true) {
        if(this.queue.includes(file)) return;
        if(this.resolver!==null) {
            const reslv = this.resolver;
            this.resolver = null;
            reslv(file);
        } else {
            this.queue.push(file);
        }
    }

    async pop():Promise<string> {
        return new Promise(resolve=> {
            if(this.queue.length>0) {
                resolve(this.queue.shift()!)
            } else {
                this.resolver = resolve;
            }
        })
    }

    async monitor() {
        while(true) {
            const file = await this.pop();
            if(file==='#END') break;
            await this.parse(file);    
        }
    }

    async parse(file: string) {
        console.log('COLLECTION PARSE INITIATED ON',file);
        let pf = new ParsedFile(file);
        await pf.parse(this);
    }

    toString(): string {
        return Object.values(this.files).map(file => file.toString()).join('\n');
    }
}

export function recurseCalls(s: string, subs: {[id:string]: ParsedSub}, subset: Set<string>): Set<string> {
    if(!(s in subs)) return new Set<string>();
    for (let c of subs[s].calls) {
        const present = subset.has(c);
        subset.add(c);
        if (!present && c in subs) {
            subset = new Set([...subset, ...recurseCalls(c, subs, subset)]);
        }
    }
    return subset;
}

export function checkVarCollisions(pr: ParsedRoutinesCollection): void {
    console.log('Checking for duplicate subs, variable collisions with call dependencies, and missing calls');
    let subs:{[id:string]:ParsedSub} = {};
    for (let f in pr.files) {
        for (let s of pr.files[f].subroutines) {
            if (s.name in subs) {
                console.log('WARNING: Ignoring duplicated subroutine:', s.name, 'defined in', subs[s.name].file, 'and duplicated in', s.file);
            } else {
                subs[s.name] = s;
            }
        }
    }
    for (let s in subs) {
        console.log(`Sub ${s}`);
        let all_calls = recurseCalls(s, subs, new Set());
        console.log('  List of calls:', Array.from(all_calls));

        let missing_calls = false;
        for (let c of subs[s].calls) {
            if (!(c in subs)) {
                console.log(`  * Subroutine ${c} is called but does not exist`);
                missing_calls = true;
            }
        }

        let collisions = false;
        for (let c in all_calls) {
            if (c in subs) {
                let colliders = subs[s].vars.filter(x => subs[c].vars.includes(x));
                if (s !== c && colliders.length > 0) {
                    console.log(`  * Collisions with sub ${c}: `, colliders);
                    collisions = true;
                }
            }
        }
        if (!collisions && !missing_calls) {
            console.log('  OK');
        }
    }
}

// os.chdir(path)

// pr = ParsedRoutines()
// pr.parse(base_file)
// print(pr)

// check_var_collisions(pr)