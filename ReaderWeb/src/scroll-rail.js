// A pointer owns a document fraction, not a stale pixel offset. Editor virtualization,
// images and incremental mounting may change scrollHeight while it is held down.
export function createScrollRail(rail,thumb,onTakeover=()=>{}) {
  let scroller=null,content=null,drag=null,frame=0;
  const clamp=v=>Math.max(0,Math.min(1,v));
  function geometry(){
    const root=scroller===document.documentElement;
    const rect=root?{top:0,height:innerHeight}:scroller.getBoundingClientRect();
    return {top:rect.top,height:rect.height,max:Math.max(0,scroller.scrollHeight-scroller.clientHeight)};
  }
  function paint(){
    frame=0;if(!scroller)return;
    const g=geometry();
    rail.style.top=g.top+'px';rail.style.height=g.height+'px';rail.hidden=g.max<=0;
    const height=drag?.height??Math.min(g.height,Math.max(56,g.height*g.height/(g.max+g.height)));
    let ratio=g.max?clamp(scroller.scrollTop/g.max):0;
    if(drag){
      ratio=clamp((drag.y-g.top-drag.grab)/Math.max(1,g.height-height));
      scroller.scrollTop=ratio*g.max;
    }
    thumb.style.height=height+'px';thumb.style.transform=`translateY(${ratio*Math.max(0,g.height-height)}px)`;
    rail.setAttribute('aria-valuenow',String(Math.round(ratio*100)));
    if(drag)schedule();
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(paint);}
  const observer=new ResizeObserver(schedule);
  rail.addEventListener('pointerdown',e=>{
    if(e.button!==0||!scroller)return;e.preventDefault();onTakeover();
    const b=thumb.getBoundingClientRect();
    drag={y:e.clientY,height:b.height,grab:e.target===thumb?e.clientY-b.top:b.height/2};
    rail.setPointerCapture(e.pointerId);rail.classList.add('dragging');schedule();
  });
  rail.addEventListener('pointermove',e=>{if(drag){drag.y=e.clientY;schedule();}});
  rail.addEventListener('wheel',e=>{
    if(!scroller)return;e.preventDefault();onTakeover();
    scroller.scrollTop+=e.deltaY*(e.deltaMode===1?24:e.deltaMode===2?scroller.clientHeight:1);
  },{passive:false});
  function finish(){if(!drag)return;cancelAnimationFrame(frame);frame=0;paint();drag=null;rail.classList.remove('dragging');schedule();}
  rail.addEventListener('pointerup',finish);rail.addEventListener('pointercancel',finish);rail.addEventListener('lostpointercapture',finish);
  window.addEventListener('resize',schedule);
  return {
    refresh:schedule,
    get dragging(){return !!drag;},
    attach(target,body){
      drag=null;rail.classList.remove('dragging');
      (scroller===document.documentElement?window:scroller)?.removeEventListener('scroll',schedule);
      observer.disconnect();scroller=target;content=body;
      (scroller===document.documentElement?window:scroller).addEventListener('scroll',schedule,{passive:true});
      observer.observe(scroller);if(content)observer.observe(content);schedule();
    }
  };
}
