// Annotations are painted as ranges, not inserted into Markdown's DOM.
export function createAnnotations(article, send, currentId, status) {
  const toolbar = document.querySelector('#selection-tools');
  let notes = [], ranges = new Map(), pending = null, timer, index = null, mounted = false;
  const ignored = 'button,.block-toolbar,.math,.diagram,svg,script,style';
  function textIndex() {
    if (index) return index;
    const nodes = [], pieces = []; let length = 0;
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, {
      acceptNode: node => node.parentElement?.closest(ignored) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    while (walker.nextNode()) {
      const node = walker.currentNode;
      nodes.push({node, start:length, end:length + node.length}); pieces.push(node.data); length += node.length;
    }
    return index = {nodes, text:pieces.join('')};
  }
  function locate(anchor, text) {
    if (!anchor.quote) return -1;
    const matches = []; let from = 0, position;
    while ((position = text.indexOf(anchor.quote, from)) >= 0) {
      const before = text.slice(Math.max(0, position - anchor.prefix.length), position);
      const after = text.slice(position + anchor.quote.length, position + anchor.quote.length + anchor.suffix.length);
      matches.push({position, exact:before === anchor.prefix && after === anchor.suffix});
      from = position + 1;
      if (matches.length > 5000) return -1; // Very repetitive text is ambiguous; retain the note without guessing.
    }
    if (matches.length === 1) return matches[0].position;
    const contextual = matches.filter(item => item.exact);
    // Even a matching old offset is not sufficient when the surrounding text is duplicated.
    return contextual.length === 1 ? contextual[0].position : -1;
  }
  function rangeAt(start, length, nodes) {
    const first = nodes.find(item => item.end > start), last = nodes.find(item => item.end >= start + length);
    if (!first || !last) return null;
    const range = document.createRange(); range.setStart(first.node, start-first.start); range.setEnd(last.node, start+length-last.start);
    return range;
  }
  function refresh() {
    if (!mounted) return;
    ranges.clear(); const missing = [];
    if (notes.some(note => note.anchor.quote)) {
      const {text,nodes} = textIndex();
      for (const note of notes) {
        if (!note.anchor.quote) continue;
        const start = locate(note.anchor, text), range = start < 0 ? null : rangeAt(start,note.anchor.quote.length,nodes);
        if (range) ranges.set(note.id,range); else missing.push(note.id);
      }
    }
    if (CSS.highlights) CSS.highlights.set('mica-notes', new Highlight(...ranges.values()));
    send({type:'annotation-state',id:currentId(),missing});
  }
  function scheduleRefresh() {
    index = null; clearTimeout(timer);
    if (mounted && notes.length) timer = setTimeout(refresh,100);
  }
  new MutationObserver(scheduleRefresh).observe(article,{subtree:true,childList:true,characterData:true});
  function hide() { toolbar.hidden = true; }
  function capture() {
    hide(); pending = null;
    const selection = getSelection();
    if (!mounted || !selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    if (!article.contains(range.startContainer) || !article.contains(range.endContainer)) return;
    const {nodes,text} = textIndex();
    const startNode = nodes.find(item => item.node === range.startContainer), endNode = nodes.find(item => item.node === range.endContainer);
    // SVG/formula labels and generated controls are not reliable plain-text anchors.
    if (!startNode || !endNode) return;
    const start = startNode.start + range.startOffset, end = endNode.start + range.endOffset;
    const quote = text.slice(start,end);
    if (!quote.trim() || quote.length > 8000) return;
    pending = {quote, start, prefix:text.slice(Math.max(0,start-64),start), suffix:text.slice(end,end+64)};
    const rect = range.getBoundingClientRect();
    toolbar.hidden = false;
    toolbar.style.left = Math.max(8,Math.min(innerWidth-toolbar.offsetWidth-24,rect.left)) + 'px';
    toolbar.style.top = Math.max(8,Math.min(innerHeight-toolbar.offsetHeight-8,rect.top-toolbar.offsetHeight-10)) + 'px';
  }
  article.addEventListener('pointerup', () => setTimeout(capture,0));
  document.addEventListener('selectionchange', () => { if (getSelection()?.isCollapsed) hide(); });
  toolbar.addEventListener('pointerdown', event => event.preventDefault());
  toolbar.addEventListener('click', event => {
    const action = event.target.closest('button')?.dataset.noteAction;
    if (!action || !pending) return;
    if (action === 'copy') send({type:'copy',text:pending.quote});
    else send({type:'annotation-create',id:currentId(),action,anchor:pending});
    hide(); getSelection()?.removeAllRanges();
  });
  article.addEventListener('click', event => {
    if (!getSelection()?.isCollapsed || event.target.closest('a,button')) return;
    const caret = document.caretRangeFromPoint(event.clientX,event.clientY); if (!caret) return;
    for (const [noteId,range] of ranges) {
      if (range.comparePoint(caret.startContainer,caret.startOffset) === 0) {
        send({type:'annotation-open',id:currentId(),noteId}); break;
      }
    }
  });
  addEventListener('scroll',hide,{passive:true}); addEventListener('resize',hide);
  return {
    reset() { mounted=false; notes=[]; ranges.clear(); index=null; pending=null; hide(); clearTimeout(timer); CSS.highlights?.delete('mica-notes'); },
    mounted() { mounted=true; index=null; refresh(); },
    receive(data) {
      if (data.id !== currentId()) return;
      if (data.type === 'annotations') { notes=data.notes; refresh(); }
      if (data.type === 'annotation-navigate') {
        const range=ranges.get(data.noteId);
        if (!range) { status.textContent='原文已变化，暂时无法定位；摘录和笔记仍完整保留。'; return; }
        const element=range.startContainer.parentElement;
        for (let parent=element; parent && parent!==article; parent=parent.parentElement) {
          if (parent.matches('details')) parent.open=true;
          if (parent.matches('.chunk')) parent.style.contentVisibility='visible';
        }
        window.scrollBy({top:range.getBoundingClientRect().top-80,behavior:'instant'});
        status.textContent='';
      }
    },
    diagnostics:() => ({count:notes.length,matched:ranges.size})
  };
}
