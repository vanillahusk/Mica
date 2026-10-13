import {compactMarkdown,hasVisibleContent,inlineMarkdown,normalizeLayoutMarkdown} from './markdown.js';

export function richSegments(nodes) {
  const segments=[];let markdown='',markdownLine=1;
  const flush=()=>{if(markdown){const leading=markdown.split('\n').findIndex(line=>line.trim()!=='');segments.push({type:'markdown',text:normalizeLayoutMarkdown(markdown),sourceLine:markdownLine+Math.max(0,leading)});markdown=''}};
  for(const node of nodes){
    if(node.type==='component'&&!hasVisibleContent(node))continue;
    if(node.type==='text'||node.kind==='inline'){if(!markdown)markdownLine=node.line||1;markdown+=inlineMarkdown(node);continue}
    if(node.kind==='unknown'&&!node.children.some(child=>child.type==='component'&&child.kind==='structural')){if(!markdown)markdownLine=node.line||1;markdown+=inlineMarkdown(node);continue}
    flush();segments.push({type:'open',name:node.name,kind:node.kind,attrs:node.attrs});segments.push(...richSegments(node.children));segments.push({type:'close',name:node.name,kind:node.kind});
  }
  flush();return segments;
}

export function simpleSegments(nodes){return [{type:'markdown',text:compactMarkdown(nodes)}]}
