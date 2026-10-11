// Merman 0.8's text-only state nodes retain the HTML label's left-offset.
// Repair only this renderer's simple state labels; do not touch routing,
// composite states, notes, flowcharts, or Mermaid's compatibility output.
export function alignStateLabels(svg) {
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = document.documentElement;
  if (!root.classList.contains('statediagram')) return svg;
  for (const node of root.querySelectorAll('.node.statediagram-state')) {
    const rect = node.querySelector(':scope > rect.basic');
    const label = node.querySelector(':scope > g.label');
    const text = label?.querySelector(':scope > text');
    const translation = label?.getAttribute('transform')?.match(/^translate\(\s*[-\d.]+[,\s]+([-\d.]+)\s*\)$/);
    if (!rect || !text || !translation) continue;
    const center = Number(rect.getAttribute('x')) + Number(rect.getAttribute('width')) / 2;
    label.setAttribute('transform', `translate(${center}, ${translation[1]})`);
    text.setAttribute('text-anchor', 'middle');
  }
  return new XMLSerializer().serializeToString(root);
}
