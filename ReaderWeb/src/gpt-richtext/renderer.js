import {compactMarkdown,hasVisibleContent,inlineMarkdown,normalizeLayoutMarkdown} from './markdown.js';

export function richSegments(nodes) {
  const segments=[];let markdown='';
  const flush=()=>{if(markdown){segments.push({type:'markdown',text:normalizeLayoutMarkdown(markdown)});markdown=''}};
  for(const node of nodes){
    if(node.type==='component'&&!hasVisibleContent(node))continue;
    if(node.type==='text'||node.kind==='inline'){markdown+=inlineMarkdown(node);continue}
    if(node.kind==='unknown'&&!node.children.some(child=>child.type==='component'&&child.kind==='structural')){markdown+=inlineMarkdown(node);continue}
    flush();segments.push({type:'open',name:node.name,kind:node.kind,attrs:node.attrs});segments.push(...richSegments(node.children));segments.push({type:'close',name:node.name,kind:node.kind});
  }
  flush();return segments;
}

export function simpleSegments(nodes){return [{type:'markdown',text:compactMarkdown(nodes)}]}
