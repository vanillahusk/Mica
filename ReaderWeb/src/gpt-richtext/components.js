export const COMPAT_VERSION = 2;

export const STRUCTURAL_COMPONENTS = new Set([
  'box','row','col','card','grid','grid-item','flow','flow-item','table','table-row','table-cell',
  'list','list-item','blockquote','carousel','carousel-item','appblock','chart','asyncimagegroup','mapwidgetv2','entity'
]);

export const INLINE_COMPONENTS = new Set([
  'text','title','caption','bold','italic','link','divider','badge','icon','codeblock','cite','filecite','asyncimage','button','input','select','br'
]);

export const KNOWN_COMPONENTS = new Set([...STRUCTURAL_COMPONENTS, ...INLINE_COMPONENTS]);

// Native HTML is left to markdown-it + DOMPurify. Everything else is treated as
// a non-executable GPT component only while rendering synchronized conversations.
export const HTML_TAGS = new Set([
  'a','abbr','address','article','aside','b','bdi','bdo','blockquote','br','caption','cite','code','col','colgroup','dd','del','details','dfn','div','dl','dt','em','figcaption','figure','footer','h1','h2','h3','h4','h5','h6','header','hr','i','img','ins','kbd','li','main','mark','nav','ol','p','pre','q','s','samp','section','small','span','strong','sub','summary','sup','table','tbody','td','tfoot','th','thead','time','tr','u','ul','var','wbr','script','style','iframe','object','embed','form','link','meta','base','svg'
]);

export function componentKind(name) {
  const key=name.toLowerCase();
  if (STRUCTURAL_COMPONENTS.has(key)) return 'structural';
  if (INLINE_COMPONENTS.has(key)) return 'inline';
  return 'unknown';
}

export function isComponentName(name) {
  const key=name.toLowerCase();
  return KNOWN_COMPONENTS.has(key) || !HTML_TAGS.has(key);
}

export function safeURL(value='') {
  const url=String(value).trim();
  return /^(https?:|mailto:)/i.test(url) ? url.replace(/[\x00-\x20]+/g,'') : '';
}
