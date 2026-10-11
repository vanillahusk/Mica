// Diagram contrast is independent of muted UI labels: connectors and entity names
// must still be legible when a large graph is fitted to a window.
const palettes={
  warm:{fill:'#252332',border:'#b09ad9',edge:'#c2bdcf',text:'#eee9f5'},
  midnight:{fill:'#202b43',border:'#9fb6ed',edge:'#b6c5df',text:'#edf2ff'},
  paper:{fill:'#f0f3fc',border:'#627bb5',edge:'#606c82',text:'#293247'},
  sepia:{fill:'#f0e6d4',border:'#937047',edge:'#77664f',text:'#403322'}
};
export function diagramConfig(palette){
  const c=palette.colors,d=palettes[palette.id]||palettes.warm;
  return {
    theme:'base',look:'classic',layout:'dagre',htmlLabels:false,
    themeCSS:`
      .node rect,.node circle,.node ellipse,.node polygon,.node path,.entityBox,.classGroup rect {
        stroke:${d.border} !important;stroke-width:1.35px !important;
      }
      .edgePath path,.flowchart-link,.relationshipLine { stroke:${d.edge} !important;stroke-width:1.35px !important; }
      .edgeLabel,.edgeLabel rect,.labelBkg { background-color:${c.bg} !important;fill:${c.bg} !important; }
      .cluster rect { fill:${c.panel} !important;stroke:${d.border} !important;stroke-width:1px !important; }
      text,.nodeLabel,.edgeLabel { font-weight:450 !important; }
    `,
    elk:{preset:'default',lineHops:'gap'},
    // Keep long entity identifiers on one line; deliberate author line breaks remain.
    flowchart:{htmlLabels:false,curve:'basis',nodeSpacing:42,rankSpacing:60,wrappingWidth:360},
    er:{minEntityWidth:120,minEntityHeight:60,entityPadding:20,nodeSpacing:55,rankSpacing:70,fontSize:16},
    state:{padding:14,nodeSpacing:80,rankSpacing:110,fontSize:16},
    themeVariables:{darkMode:palette.scheme==='dark',background:c.bg,fontSize:'16px',
      fontFamily:'Segoe UI, Microsoft YaHei UI, sans-serif',primaryColor:d.fill,
      primaryTextColor:d.text,primaryBorderColor:d.border,lineColor:d.edge,textColor:d.text,
      mainBkg:d.fill,nodeBorder:d.border,secondaryColor:d.fill,tertiaryColor:c.panel,
      edgeLabelBackground:c.bg,clusterBkg:c.panel,clusterBorder:d.border,
      noteBkgColor:d.fill,noteTextColor:d.text,noteBorderColor:d.border}
  };
}
