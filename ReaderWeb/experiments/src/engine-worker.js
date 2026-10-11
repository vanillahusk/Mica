import {initMerman,renderSvg} from '/merman/dist/package-entries/render.js';
let ready;
onmessage=async({data})=>{
  const started=performance.now();
  try {
    // Test-only fault injection: a busy renderer cannot service its own cancel message.
    if(data.operation==='busy') { const until=performance.now()+data.duration; while(performance.now()<until) {} postMessage({id:data.id,value:'finished'}); return; }
    ready??=initMerman(); await ready;
    if(data.operation==='warm') {postMessage({id:data.id,value:true});return;}
    const svg=renderSvg(data.source,{site_config:{theme:'dark',htmlLabels:false,flowchart:{htmlLabels:false}},resources:{profile:'interactive'},...(data.safePipeline?{svg:{pipeline:'resvg-safe',root_background_color:'#242321'}}:{})});
    postMessage({id:data.id,value:svg,computeMs:performance.now()-started});
  } catch(e) {postMessage({id:data.id,error:String(e?.message||e)});}
};
