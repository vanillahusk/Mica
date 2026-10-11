import DOMPurify from 'dompurify';
import {WorkerClient} from './worker-client.js';
const client=new WorkerClient(),surface=document.querySelector('#surface');
let mermaidReady,mermanReady,seq=0;
async function mermaid(){
  mermaidReady??=import('mermaid').then(({default:lib})=>{lib.initialize({startOnLoad:false,securityLevel:'strict',suppressErrorRendering:true,theme:'dark',htmlLabels:false,flowchart:{htmlLabels:false}});return lib;});
  return mermaidReady;
}
async function merman(){mermanReady??=import('/merman/dist/package-entries/render.js').then(async lib=>{await lib.initMerman();return lib;});return mermanReady;}
const frame=()=>new Promise(requestAnimationFrame);
window.experiment={
  async render(engine,source){
    let ticks=0,last=performance.now(),maxGap=0;
    const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;ticks++;document.querySelector('#pulse').textContent=String(ticks);document.querySelector('#scroll').scrollTop+=3;},10);
    const started=performance.now();
    try {
      let svg;
      if(engine==='mermaid-main')svg=(await (await mermaid()).render('bench-'+(++seq),source)).svg;
      else if(engine==='merman-main')svg=(await merman()).renderSvg(source,{site_config:{theme:'dark',htmlLabels:false,flowchart:{htmlLabels:false}},resources:{profile:'interactive'}});
      else svg=(await client.run(source,{safePipeline:engine==='merman-worker-safe'})).value;
      const rendered=performance.now();
      surface.innerHTML=DOMPurify.sanitize(svg,{USE_PROFILES:{svg:true,svgFilters:true},FORBID_TAGS:['foreignObject','script']});
      await frame();await frame();
      const el=surface.querySelector('svg'),vb=el?.viewBox.baseVal;
      // Include the last synchronous gap even when no interval callback got a chance to run.
      maxGap=Math.max(maxGap,performance.now()-last);
      const labels=[...surface.querySelectorAll('svg text')].map(el=>el.textContent).join(' ');
      return {renderMs:rendered-started,displayMs:performance.now()-started,maxTimerGapMs:maxGap,ticks,svgBytes:svg.length,labels,width:vb?.width,height:vb?.height,valid:!!el};
    } catch(e){return {error:String(e?.message||e),displayMs:performance.now()-started};}
    finally{clearInterval(timer);}
  },
  async watchdog(){
    await client.run('',{operation:'warm'});
    let ticks=0;const timer=setInterval(()=>ticks++,10);let result;
    const start=performance.now();
    try{await client.run('',{operation:'busy',duration:5000,timeout:100});result='unexpected success';}catch(e){result=e.message;}
    clearInterval(timer);
    const elapsed=performance.now()-start;
    const recovered=await client.run('flowchart LR\n A[Recovered]-->B[Ready]');
    const cancelled=client.run('',{operation:'busy',duration:5000,timeout:10000}).catch(e=>e.message);
    setTimeout(()=>client.cancel('document switched'),50);
    return {result,elapsed,ticks,recovered:recovered.value.includes('Recovered'),cancelResult:await cancelled,restarts:client.restarts};
  }
};
