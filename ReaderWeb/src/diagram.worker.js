import {initMerman,renderSvg} from '/merman/dist/package-entries/render.js';
import {diagramConfig} from './diagram-theme.js';
let ready;
onmessage=async({data})=>{
  try {
    if(typeof data.source!=='string'||data.source.length>100000)throw new Error('图表超过长度限制');
    ready??=initMerman();await ready;
    const svg=renderSvg(data.source,{
      site_config:diagramConfig(data.palette),
      resources:{profile:'interactive'},svg:{pipeline:'resvg-safe',root_background_color:data.palette.colors.bg}
    });
    if(svg.length>4000000)throw new Error('图表输出超过安全限制');
    postMessage({id:data.id,svg});
  }catch(error){postMessage({id:data.id,error:String(error?.message||error).slice(0,500)});}
};
