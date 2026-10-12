import {componentKind} from './components.js';
import {tokenizeRichText} from './tokenizer.js';

const MAX_DEPTH=32,MAX_NODES=50000;

export function parseRichText(source) {
  const root={type:'root',children:[]},stack=[root];let count=0,detected=false;
  for(const token of tokenizeRichText(source)){
    if(++count>MAX_NODES)throw new Error('GPT rich content node limit exceeded');
    if(token.type==='text'){stack.at(-1).children.push(token);continue}
    detected=true;const name=token.name.toLowerCase();
    if(token.closing){
      if(stack.length>1&&stack.at(-1).name===name)stack.pop();
      continue;
    }
    const node={type:'component',name,sourceName:token.name,kind:componentKind(name),attrs:token.attrs,children:[]};
    stack.at(-1).children.push(node);
    if(!token.selfClosing){if(stack.length>=MAX_DEPTH)throw new Error('GPT rich content nesting limit exceeded');stack.push(node)}
  }
  return {root,detected,unclosed:stack.length-1};
}
