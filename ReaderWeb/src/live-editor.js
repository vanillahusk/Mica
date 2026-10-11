import { EditorState, StateField, StateEffect, Compartment } from '@codemirror/state';
import { EditorView, Decoration, ViewPlugin, WidgetType, keymap } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { defaultKeymap, history, historyKeymap, undo, redo } from '@codemirror/commands';
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';

const md = new MarkdownIt({ html:false, linkify:false });

// Markdown remains the source of truth. Decorations never serialize a rich-text DOM back into Markdown.
export function createLiveEditor(parent, text, onChange, renderers) {
  let changed = false;
  let pointerSelecting=false, composing=false, disposed=false;
  const settle=StateEffect.define();
  const refresh=StateEffect.define();
  const counters={blockScans:0,inlineBuilds:0};
  const widgetJobs=new WeakMap();
  const typography=new Compartment();
  const fontTheme=()=>EditorView.theme({'&':{fontSize:getComputedStyle(parent).fontSize}});
  // A non-empty selection is not an instruction to expose every selected block's source.
  // Keep the editing context fixed throughout mouse dragging and IME composition.
  const activePosition=StateField.define({create:()=>0,update(pos,tr){
    pos=tr.changes.mapPos(pos);
    if(!pointerSelecting&&!composing && tr.state.selection.main.empty &&
      (tr.selection||tr.docChanged||tr.effects.some(e=>e.is(settle))))return tr.state.selection.main.head;
    return pos;
  }});
  const touches=(state,from,to)=>{const pos=state.field(activePosition);return pos>=from&&pos<=to;};
  const activeLine=(state,from,to)=>touches(state,state.doc.lineAt(from).from,state.doc.lineAt(to).to);
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  class InlinePreview extends WidgetType {
    constructor(source,kind) {super();this.source=source;this.kind=kind;}
    eq(other){return other.source===this.source&&other.kind===this.kind;}
    toDOM(){
      const el=document.createElement('span');
      if(this.kind==='bullet'){el.textContent='•';el.className='live-bullet';}
      else if(this.kind==='math') {el.className='math';el.dataset.source=this.source;void renderers.math(el);}
      else {
        el.className='live-image';el.innerHTML=DOMPurify.sanitize(md.renderInline(this.source),{ALLOWED_TAGS:['img'],ALLOWED_ATTR:['src','alt','title']});
        for(const image of el.querySelectorAll('img')) {
          const src=image.getAttribute('src')||'';
          if(!/^(https:|data:image\/|blob:)/i.test(src)) image.src=renderers.imageBase && !/^[a-z][a-z0-9+.-]*:/i.test(src) ? new URL(src.replaceAll('\\','/'),renderers.imageBase).href : '';
        }
      }
      return el;
    }
    ignoreEvent(){return false;}
  }
  class BlockPreview extends WidgetType {
    constructor(source, kind) { super(); this.source=source; this.kind=kind;this.appearance=renderers.revision(); }
    eq(other) { return other.source===this.source && other.kind===this.kind&&other.appearance===this.appearance; }
    toDOM(view) {
      const box=document.createElement('div'); box.className='live-block';
      const head=document.createElement('div'); head.className='live-block-head';
      const label=document.createElement('span');
      const button=document.createElement('button'); button.textContent='编辑'; button.type='button';
      button.setAttribute('aria-label','编辑此内容块');
      button.onmousedown=e=>e.preventDefault();
      button.onclick=()=>{
        const pos=view.posAtDOM(box), line=view.state.doc.lineAt(pos);
        const target=this.kind==='FencedCode' ? Math.min(view.state.doc.length,line.to+1) : pos;
        view.dispatch({selection:{anchor:target},scrollIntoView:true}); view.focus();
      };
      const content=document.createElement('div'); content.className='live-block-content';
      head.append(label,button);box.append(head,content);
      if(this.kind==='Math') {
        label.textContent='公式';content.classList.add('math','math-block');
        content.dataset.source=this.source.trim().slice(2,-2);void renderers.math(content);
      } else if(this.kind==='Table') {
        label.textContent='表格'; content.innerHTML=DOMPurify.sanitize(md.render(this.source));
        content.title='点击单元格，直接编辑对应的 Markdown 内容';
        content.addEventListener('click',event=>{
          const cell=event.target.closest('th,td');if(!cell)return;
          const row=cell.parentElement.rowIndex,column=cell.cellIndex,lines=this.source.split('\n');
          const sourceRow=row===0?0:row+1,line=lines[sourceRow];if(line==null)return;
          const cells=[];let start=0,escaped=false;
          for(let i=0;i<=line.length;i++){
            const char=line[i];if(char==='\\'&&!escaped){escaped=true;continue;}
            if((char==='|'&&!escaped)||i===line.length){cells.push({from:start,to:i});start=i+1;}escaped=false;
          }
          const visible=cells.filter((part,index)=>!(index===0&&part.to===0)&&!(index===cells.length-1&&part.from===line.length));
          const part=visible[column];if(!part)return;
          const base=view.posAtDOM(box)+lines.slice(0,sourceRow).reduce((n,value)=>n+value.length+1,0);
          let from=part.from,to=part.to;while(from<to&&/\s/.test(line[from]))from++;while(to>from&&/\s/.test(line[to-1]))to--;
          view.dispatch({selection:{anchor:base+from,head:base+to},scrollIntoView:true});view.focus();
        });
      } else {
        const lines=this.source.split('\n'), language=lines[0].replace(/^\s*[`~]+/,'').trim().split(/\s/)[0];
        const source=lines.slice(1,/^\s*(`{3,}|~{3,})\s*$/.test(lines.at(-1))?-1:undefined).join('\n');
        label.textContent=language || '纯文本';
        if(language==='mermaid') {
          content.classList.add('live-diagram'); content.textContent='正在绘制…';
          const job={abort:new AbortController()};widgetJobs.set(box,job);
          job.timer=setTimeout(()=>{
            if(!content.isConnected||disposed)return;
            renderers.svg(source,{signal:job.abort.signal}).then(svg=>{if(content.isConnected)content.innerHTML=svg;}).catch(error=>{if(content.isConnected&&error.name!=='AbortError')content.textContent='图表未完成，可返回阅读重试或使用兼容绘图。';});
          },300);
        } else {
          const pre=document.createElement('pre'),code=document.createElement('code'); code.textContent=source;
          code.dataset.language=language;pre.append(code);content.append(pre);void renderers.highlight(code);
        }
      }
      return box;
    }
    ignoreEvent() { return true; }
    destroy(dom){const job=widgetJobs.get(dom);if(job){clearTimeout(job.timer);job.abort.abort();widgetJobs.delete(dom);}}
  }
  function blockIndex(state) {
    counters.blockScans++;
    const index=[];
    syntaxTree(state).iterate({enter(node){
      let kind=node.name;
      if(kind==='Paragraph' && /^(\$\$[\s\S]+\$\$|\\\[[\s\S]+\\\])$/.test(state.doc.sliceString(node.from,node.to).trim()))kind='Math';
      if(!['FencedCode','Table','Math'].includes(kind))return;
      index.push({from:node.from,to:node.to,kind,source:state.doc.sliceString(node.from,node.to)});
      return false;
    }});
    return index;
  }
  function activeBlock(index,pos){let lo=0,hi=index.length-1;while(lo<=hi){const mid=(lo+hi)>>1,b=index[mid];if(pos<b.from)hi=mid-1;else if(pos>b.to)lo=mid+1;else return mid;}return -1;}
  const previewRange=b=>Decoration.replace({block:true,widget:new BlockPreview(b.source,b.kind)}).range(b.from,b.to);
  function blockState(state){const index=blockIndex(state),active=activeBlock(index,state.field(activePosition));return {index,active,decorations:Decoration.set(index.filter((_,i)=>i!==active).map(previewRange),true)};}
  const blockField=StateField.define({create:blockState,update(value,tr){
    if(tr.docChanged||syntaxTree(tr.startState)!==syntaxTree(tr.state)||tr.effects.some(e=>e.is(refresh)))return blockState(tr.state);
    const active=activeBlock(value.index,tr.state.field(activePosition));
    if(active===value.active)return value;
    const old=value.index[value.active],next=value.index[active];
    const decorations=value.decorations.update({filter:(from,to)=>!next||from!==next.from||to!==next.to,add:old?[previewRange(old)]:[],sort:true});
    return {...value,active,decorations};
  },provide:field=>EditorView.decorations.from(field,value=>value.decorations)});
  const inline=ViewPlugin.fromClass(class {
    constructor(view){this.decorations=this.build(view);}
    update(update){
      const oldLine=update.startState.doc.lineAt(update.startState.field(activePosition)).from;
      const newLine=update.state.doc.lineAt(update.state.field(activePosition)).from;
      if(update.docChanged||oldLine!==newLine||update.viewportChanged||syntaxTree(update.startState)!==syntaxTree(update.state))this.decorations=this.build(update.view);
    }
    build(view){
      counters.inlineBuilds++;
      const ranges=[],lineMarks=new Set(),state=view.state;
      const mark=(from,to,cls)=>{if(to>from)ranges.push(Decoration.mark({class:cls}).range(from,to));};
      const line=(pos,cls)=>{pos=state.doc.lineAt(pos).from;const key=pos+cls;if(!lineMarks.has(key)){lineMarks.add(key);ranges.push(Decoration.line({class:cls}).range(pos));}};
      for(const visible of view.visibleRanges) syntaxTree(state).iterate({from:visible.from,to:visible.to,enter(node){
        const {from,to,name}=node;
        if(name==='FencedCode'){
          if(touches(state,from,to))for(let n=state.doc.lineAt(Math.max(from,visible.from)).number;n<=state.doc.lineAt(Math.min(to,visible.to)).number;n++)line(state.doc.line(n).from,'live-code-line');
          return false;
        }
        if(name==='Table')return false;
        if(name==='Image'&&!activeLine(state,from,to)){
          ranges.push(Decoration.replace({widget:new InlinePreview(state.doc.sliceString(from,to),'image')}).range(from,to));return false;
        }
        if(/^ATXHeading[1-6]$/.test(name))line(from,'live-h'+name.at(-1));
        if(name==='Blockquote') for(let n=state.doc.lineAt(Math.max(from,visible.from)).number;n<=state.doc.lineAt(Math.min(to,visible.to)).number;n++)line(state.doc.line(n).from,'live-quote');
        if(name==='StrongEmphasis')mark(from,to,'live-strong');
        if(name==='Emphasis')mark(from,to,'live-em');
        if(name==='Strikethrough')mark(from,to,'live-del');
        if(name==='InlineCode')mark(from,to,'live-inline-code');
        if(name==='Link')mark(from,to,'live-link');
        if(['HeaderMark','EmphasisMark','CodeMark','StrikethroughMark','QuoteMark'].includes(name)){
          if(!activeLine(state,from,to))ranges.push(Decoration.replace({}).range(from,to));
          else mark(from,to,'live-syntax');
        }
        if(name==='ListMark' && /^[-+*]$/.test(state.doc.sliceString(from,to)) && !activeLine(state,from,to))ranges.push(Decoration.replace({widget:new InlinePreview('','bullet')}).range(from,to));
        else if(name==='ListMark'||name==='TaskMarker')mark(from,to,'live-list-mark');
        if(name==='URL'||name==='LinkMark')mark(from,to,'live-syntax');
        if(name==='Paragraph') {
          const source=state.doc.sliceString(from,to), expression=/(?<![\\$])\$([^$\n]+)\$(?!\$)/g;
          for(const match of source.matchAll(expression)){
            const start=from+match.index,end=start+match[0].length;
            let ancestor=syntaxTree(state).resolveInner(start,1),excluded=false;
            while(ancestor){if(['InlineCode','Link','Image','HTMLTag'].includes(ancestor.name))excluded=true;ancestor=ancestor.parent;}
            if(!excluded&&!activeLine(state,start,end))ranges.push(Decoration.replace({widget:new InlinePreview(match[1],'math')}).range(start,end));
          }
        }
      }});
      return Decoration.set(ranges,true);
    }
  },{decorations:v=>v.decorations});
  const view=new EditorView({parent,state:EditorState.create({doc:text,extensions:[
    EditorState.lineSeparator.of(newline), markdown({base:markdownLanguage,completeHTMLTags:false}),
    // Native selection paints above quote/code backgrounds and uses the same glyph
    // geometry as the text. A separate selection layer is unnecessary for this single-caret editor.
    history(),keymap.of([...defaultKeymap,...historyKeymap]),EditorView.lineWrapping,
    typography.of(fontTheme()),activePosition,blockField,inline,EditorView.contentAttributes.of({'aria-label':'实时 Markdown 编辑器',spellcheck:'false'}),
    EditorView.domEventHandlers({pointerdown(){pointerSelecting=true;},compositionstart(){composing=true;},compositionend(){composing=false;setTimeout(()=>{if(!disposed)view.dispatch({effects:settle.of(null)});},0);}}),
    EditorView.updateListener.of(update=>{if(update.docChanged){changed=true;onChange();}}),
    EditorView.theme({'&':{backgroundColor:'transparent',color:'var(--text)'},'&.cm-focused':{outline:'none'},
      '.cm-content':{caretColor:'var(--accent)'},'.cm-cursor':{borderLeftColor:'var(--accent)'}})
  ]})});
  const pointerEnd=()=>{if(!pointerSelecting)return;pointerSelecting=false;if(!disposed)view.dispatch({effects:settle.of(null)});};
  window.addEventListener('pointerup',pointerEnd);window.addEventListener('pointercancel',pointerEnd);
  // Keep native scrolling virtualized instead of mounting the whole editable document.
  function command(action){
    view.focus();
    if(action==='undo')return undo(view);
    if(action==='redo')return redo(view);
    const selection=view.state.selection.main, from=selection.from,to=selection.to, selected=view.state.sliceDoc(from,to);
    const pairs={bold:['**','**','重点'],italic:['*','*','强调'],code:['`','`','代码'],link:['[','](https://)','链接文字']};
    if(pairs[action]){
      const [before,after,fallback]=pairs[action],body=selected||fallback;
      view.dispatch({changes:{from,to,insert:before+body+after},selection:{anchor:from+before.length,head:from+before.length+body.length},scrollIntoView:true});
    } else {
      const prefix={heading:'## ',list:'- ',quote:'> ',task:'- [ ] '}[action];if(!prefix)return;
      const start=view.state.doc.lineAt(from),end=view.state.doc.lineAt(to);
      const changes=[];for(let n=start.number;n<=end.number;n++)changes.push({from:view.state.doc.line(n).from,insert:prefix});
      view.dispatch({changes,scrollIntoView:true});
    }
  }
  return {view,command,refreshLayout:()=>view.dispatch({effects:typography.reconfigure(fontTheme())}),refreshPreviews:()=>view.dispatch({effects:refresh.of(null)}),diagnostics:()=>({...counters,composing,pointerSelecting}),
    goToLine(line){const pos=view.state.doc.line(Math.max(1,Math.min(line,view.state.doc.lines))).from;view.dispatch({selection:{anchor:pos},effects:EditorView.scrollIntoView(pos,{y:'start',yMargin:24})});},
    snapshot:()=>({text:changed?view.state.sliceDoc():text,changed,composing:composing||view.composing,line:view.state.doc.lineAt(view.lineBlockAtHeight(Math.max(0,view.scrollDOM.getBoundingClientRect().top-view.documentTop+24)).from).number}),
    destroy(){disposed=true;window.removeEventListener('pointerup',pointerEnd);window.removeEventListener('pointercancel',pointerEnd);view.destroy();}};
}
