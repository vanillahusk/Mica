import {componentKind} from './components.js';
import {tokenizeRichText} from './tokenizer.js';

const MAX_DEPTH=32,MAX_NODES=50000;

export function parseRichText(source) {
  const root={type:'root',children:[]},stack=[root],tokens=tokenizeRichText(source);let count=0,detected=false,recovered=0;
  const hasFutureClose=(name,start)=>{let depth=1;for(let i=start+1;i<tokens.length;i++){const next=tokens[i];if(next.type!=='tag'||next.name.toLowerCase()!==name)continue;if(next.closing)depth--;else if(!next.selfClosing)depth++;if(depth===0)return true}return false};
  const recoveryBoundary=value=>{const match=/\n[ \t]*\n(?=[ \t]{0,3}(?:#{1,6}[ \t]+|`{3,}|~{3,}|> ?\[!))/m.exec(value);return match?match.index+match[0].length:-1};
  for(let index=0;index<tokens.length;index++){
    const token=tokens[index];
    if(++count>MAX_NODES)throw new Error('GPT rich content node limit exceeded');
    if(token.type==='text'){
      const boundary=recoveryBoundary(token.value);let recoverAt=-1;
      if(boundary>=0)for(let i=1;i<stack.length;i++){if(stack[i].kind==='structural'&&!hasFutureClose(stack[i].name,index)){recoverAt=i;break}}
      if(recoverAt>=1){
        const before=token.value.slice(0,boundary),after=token.value.slice(boundary);if(before)stack.at(-1).children.push({...token,value:before});
        stack.length=recoverAt;recovered++;if(after)stack.at(-1).children.push({...token,value:after,line:token.line+(before.match(/\n/g)||[]).length});continue;
      }
      stack.at(-1).children.push(token);continue;
    }
    detected=true;const name=token.name.toLowerCase();
    if(token.closing){
      if(stack.length>1&&stack.at(-1).name===name)stack.pop();
      continue;
    }
    const node={type:'component',name,sourceName:token.name,kind:componentKind(name),attrs:token.attrs,line:token.line,children:[]};
    stack.at(-1).children.push(node);
    if(!token.selfClosing){if(stack.length>=MAX_DEPTH)throw new Error('GPT rich content nesting limit exceeded');stack.push(node)}
  }
  return {root,detected,unclosed:stack.length-1,recovered};
}
