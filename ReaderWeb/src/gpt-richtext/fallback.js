import {tokenizeRichText} from './tokenizer.js';

export function readableFallback(source) {
  return tokenizeRichText(source).filter(token=>token.type==='text').map(token=>token.value).join('');
}
