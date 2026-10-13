import {isComponentName} from './components.js';

const MAX_TAG_LENGTH=8192,MAX_ATTR_LENGTH=4096;

function readTag(source,start) {
  let i=start+1,quote='';
  for(;i<source.length&&i-start<=MAX_TAG_LENGTH;i++){
    const ch=source[i];
    if(quote){if(ch===quote)quote='';continue}
    if(ch==='"'||ch==="'"){quote=ch;continue}
    if(ch==='>')break;
  }
  if(i>=source.length||i-start>MAX_TAG_LENGTH)return null;
  const raw=source.slice(start,i+1),body=raw.slice(1,-1).trim();
  if(!body||body[0]==='!'||body[0]==='?')return null;
  const closing=body[0]==='/',content=(closing?body.slice(1):body).trim();
  const match=/^([A-Za-z][\w:.-]*)/.exec(content);if(!match||!isComponentName(match[1]))return null;
  const name=match[1],selfClosing=!closing&&/\/\s*$/.test(content),attrs={};
  if(!closing){
    const tail=content.slice(match[0].length,selfClosing?content.lastIndexOf('/'):content.length);let p=0,count=0;
    while(p<tail.length&&count++<64){
      while(/\s/.test(tail[p]||''))p++;const key=/^[\w:.-]+/.exec(tail.slice(p));if(!key)break;p+=key[0].length;
      while(/\s/.test(tail[p]||''))p++;let value='';
      if(tail[p]==='='){p++;while(/\s/.test(tail[p]||''))p++;const q=tail[p];if(q==='"'||q==="'"){p++;const end=tail.indexOf(q,p);value=tail.slice(p,end<0?tail.length:end);p=end<0?tail.length:end+1}else{const v=/^[^\s>]+/.exec(tail.slice(p));value=v?.[0]||'';p+=value.length}}
      attrs[key[0].toLowerCase()]=value.slice(0,MAX_ATTR_LENGTH);
    }
  }
  return {end:i+1,token:{type:'tag',name,closing,selfClosing,attrs,raw}};
}

function ticksAt(source,index){let n=0;while(source[index+n]==='`')n++;return n}

export function tokenizeRichText(source) {
  const tokens=[];let text='',i=0,lineStart=true,fence='',line=1,textLine=1;
  const flush=()=>{if(text){tokens.push({type:'text',value:text,line:textLine});text=''}};
  const append=value=>{if(!text)textLine=line;text+=value;const breaks=(value.match(/\n/g)||[]).length;line+=breaks;lineStart=value.endsWith('\n')};
  while(i<source.length){
    if(lineStart){
      let p=i,spaces=0;while(spaces<4&&source[p]===' '){p++;spaces++}
      const marker=source[p];let count=0;while(source[p+count]===marker&&(marker==='`'||marker==='~'))count++;
      if(count>=3){const run=marker.repeat(count);if(!fence)fence=run;else if(marker===fence[0]&&count>=fence.length)fence=''}
    }
    if(!fence&&source[i]==='`'){
      const count=ticksAt(source,i),run='`'.repeat(count),end=source.indexOf(run,i+count);
      if(end>=0){const value=source.slice(i,end+count);append(value);i=end+count;continue}
    }
    if(!fence&&source[i]==='<'){
      const found=readTag(source,i);if(found){flush();found.token.line=line;tokens.push(found.token);const raw=found.token.raw;line+=(raw.match(/\n/g)||[]).length;i=found.end;lineStart=raw.endsWith('\n');textLine=line;continue}
    }
    const ch=source[i++];append(ch);
  }
  flush();return tokens;
}
