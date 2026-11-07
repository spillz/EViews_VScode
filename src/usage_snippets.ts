/**
 * Convert command usage variants into [label, snippet body] pairs.
 * Keeping this independent of VS Code makes snippet parsing testable.
 */
export function buildUsageSnippetBodies(usage:string, kw:string):Array<[string, string]> {
  const snippets:Array<[string, string]> = [];
  for(let use of usage.split('\n')) {
    const k = use.indexOf(kw);
    if(k===-1) continue; // indexOf returns -1, never undefined
    let options = use.slice(k+kw.length);
    let new_use = use.slice(0,k+kw.length);
    let i = 0;
    while(true) {
      ++i;
      let match = options.match(/^(\s*\(\s*options\s*\))/i); // Optional command options in parentheses
      if(match) {
        options = options.slice(match[0].length);
        new_use = new_use+'${'+String(i)+':'+match[0]+'}';
        continue;
      }
      match = options.match(/^(\s*)\((.*?)\)/i); // Other parenthesized arguments
      if(match) {
        options = options.slice(match[0].length);
        new_use = new_use+match[1]+'(${'+String(i)+':'+match[2]+'})';
        continue;
      }
      match = options.match(/^(\s+[^\s^[^\],]+|\s+\[.*?\])/); // Other arguments, possibly optional
      if(!match || match[0].length===0) break;
      options = options.slice(match[0].length);
      if(match[1].trimStart().startsWith('@')) {
        new_use = new_use+match[0]; // Required @keywords are literal, not placeholders
      } else {
        new_use = new_use+'${'+String(i)+':'+match[1]+'}';
      }
    }
    snippets.push([use, new_use]);
  }
  return snippets;
}
