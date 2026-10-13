import {COMPAT_VERSION} from './components.js';
import {readableFallback} from './fallback.js';
import {parseRichText} from './parser.js';
import {richSegments,simpleSegments} from './renderer.js';
import {compactMarkdown} from './markdown.js';

export function detectGptRichText(source) {
  try{return parseRichText(source).detected}catch{return true}
}

export function adaptGptRichText(source,{mode='rich'}={}) {
  try{
    const parsed=parseRichText(source);
    if(!parsed.detected)return {detected:false,compatVersion:COMPAT_VERSION,markdown:source,segments:[{type:'markdown',text:source}]};
    const markdown=compactMarkdown(parsed.root.children);
    return {detected:true,compatVersion:COMPAT_VERSION,markdown,segments:mode==='compact'?simpleSegments(parsed.root.children):richSegments(parsed.root.children),unclosed:parsed.unclosed,recovered:parsed.recovered};
  }catch(error){
    const markdown=readableFallback(source);
    return {detected:true,degraded:true,compatVersion:COMPAT_VERSION,markdown,segments:[{type:'markdown',text:markdown}],error:String(error.message||error)};
  }
}
