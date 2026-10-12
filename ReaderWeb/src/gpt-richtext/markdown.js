import {safeURL} from './components.js';

const textOf=node=>node.type==='text'?node.value:node.children.map(textOf).join('');
const cleanLabel=value=>value.replace(/[\r\n]+/g,' ').replace(/\s+/g,' ').trim();
function quote(value){return value.trim().split('\n').map(line=>'> '+line).join('\n')+'\n\n'}

export function inlineMarkdown(node) {
  if(node.type==='text')return node.value;
  const inner=node.children.map(inlineMarkdown).join(''),label=cleanLabel(inner);
  switch(node.name){
    case 'bold': return `**${inner}**`;
    case 'italic': return `_${inner}_`;
    case 'link': {const href=safeURL(node.attrs.href||node.attrs.url||node.attrs.to);return href?`[${label||href}](${href})`:inner}
    case 'title': {const level=Math.min(6,Math.max(1,Number(node.attrs.level)||2));return `\n\n${'#'.repeat(level)} ${label}\n\n`}
    case 'caption': return `\n\n_${inner.trim()}_\n\n`;
    case 'divider': return '\n\n---\n\n';
    case 'badge': return `**${label}**`;
    case 'icon': return label?`[${label}]`:'';
    case 'br': return '\n';
    case 'codeblock': {const lang=(node.attrs.language||node.attrs.lang||'text').replace(/[^\w+-]/g,'').slice(0,32);return `\n\n\`\`\`${lang}\n${textOf(node)}\n\`\`\`\n\n`}
    case 'asyncimage': {const href=safeURL(node.attrs.src||node.attrs.url);const alt=cleanLabel(node.attrs.alt||inner)||'图片';return href?`![${alt}](${href})`:inner||`_${alt}不可用_`}
    case 'cite': case 'filecite': case 'button': case 'input': case 'select': return inner||node.attrs.label||node.attrs.value||'';
    default: return inner;
  }
}

export function compactMarkdown(nodes) {
  let out='';
  for(const node of nodes){
    if(node.type==='text'||node.kind==='inline'||node.kind==='unknown'){out+=inlineMarkdown(node);continue}
    const inner=compactMarkdown(node.children);
    if(node.name==='blockquote'||node.name==='box'||node.name==='card'||node.name==='appblock')out+='\n\n'+quote(inner);
    else if(node.name==='list-item')out+='\n- '+inner.trim();
    else out+='\n\n'+inner+'\n\n';
  }
  return out.replace(/\n{4,}/g,'\n\n\n');
}
