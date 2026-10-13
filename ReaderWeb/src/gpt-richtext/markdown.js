import {safeURL} from './components.js';

const textOf=node=>node.type==='text'?node.value:node.children.map(textOf).join('');
const cleanLabel=value=>value.replace(/[\r\n]+/g,' ').replace(/\s+/g,' ').trim();
const ICONS={
  'book-open':'📖',book:'📖','check-circle':'✓',check:'✓',github:'◉',code:'‹›',
  info:'ⓘ','alert-triangle':'⚠','external-link':'↗','file-text':'▤',file:'▤',
  package:'◇',terminal:'›_',star:'★',clock:'◷',link:'↗',search:'⌕'
};
function quote(value){return value.trim().split('\n').map(line=>'> '+line).join('\n')+'\n\n'}

// Remove JSX-like layout indentation while retaining indentation relative to
// that baseline (nested lists and genuine indented code).
export function normalizeLayoutMarkdown(value) {
  const lines=value.replace(/\r\n?/g,'\n').split('\n');
  while(lines.length&&lines[0].trim()==='')lines.shift();
  while(lines.length&&lines.at(-1).trim()==='')lines.pop();
  const indents=lines.filter(line=>line.trim()).map(line=>(/^[ \t]*/.exec(line)?.[0]||'').replace(/\t/g,'    ').length);
  const common=indents.length?Math.min(...indents):0;
  if(common)for(let i=0;i<lines.length;i++)lines[i]=lines[i].replace(/^[ \t]*/,prefix=>{let used=0,out='';for(const ch of prefix){const width=ch==='\t'?4:1;if(used+width>common)out+=ch;else used+=width}return out});
  return lines.join('\n');
}

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
    case 'icon': return label||ICONS[String(node.attrs.name||'').toLowerCase()]||'';
    case 'br': return '\n';
    case 'codeblock': {const lang=(node.attrs.language||node.attrs.lang||'text').replace(/[^\w+-]/g,'').slice(0,32);return `\n\n\`\`\`${lang}\n${textOf(node)}\n\`\`\`\n\n`}
    case 'asyncimage': {const href=safeURL(node.attrs.src||node.attrs.url);const alt=cleanLabel(node.attrs.alt||inner)||'图片';return href?`![${alt}](${href})`:inner||`_${alt}不可用_`}
    case 'cite': case 'filecite': case 'button': case 'input': case 'select': return inner||node.attrs.label||node.attrs.value||'';
    default: return inner;
  }
}

export function hasVisibleContent(node) {
  if(node.type==='text')return /\S/.test(node.value);
  if(node.kind==='inline')return /\S/.test(inlineMarkdown(node));
  return node.children.some(hasVisibleContent);
}

export function compactMarkdown(nodes) {
  let out='';
  for(const node of nodes){
    if(node.type==='text'||node.kind==='inline'||node.kind==='unknown'){out+=inlineMarkdown(node);continue}
    const inner=normalizeLayoutMarkdown(compactMarkdown(node.children));
    if(node.name==='blockquote'||node.name==='box'||node.name==='card'||node.name==='appblock')out+='\n\n'+quote(inner);
    else if(node.name==='list-item')out+='\n- '+inner.trim();
    else out+='\n\n'+inner+'\n\n';
  }
  return out.replace(/\n{4,}/g,'\n\n\n');
}
