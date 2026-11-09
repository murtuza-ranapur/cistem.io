/**
 * The open diagram as an image: the whole drawing (not just what's on screen), without the grid, selection or
 * any app chrome, in the light theme, with the app's fonts embedded — as an SVG, or a PNG at 2× for pasting into
 * Confluence, docs or slides.
 *
 * How: clone the canvas <svg>, copy each element's computed style inline (the CSS doesn't travel with an image),
 * frame it on the drawing's bounds, add canvas notes as HTML in <foreignObject>, and embed the fonts as data: URLs.
 */
import { editor, useEditor } from '../store/editor';

const PAD = 32;
/** Interaction-only bits (hit areas, ports, handles, cut labels): not part of the picture. */
const DROP = '.hit, .port, .ports, [data-port], .edge-label.hidden, .handle, .handles';
const SVG_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin',
  'stroke-opacity', 'opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'text-anchor', 'dominant-baseline',
  'visibility', 'display', 'rx', 'ry', 'transform', 'transform-origin', 'transform-box', 'paint-order', 'filter', 'color', 'marker-start', 'marker-end'];
const FONTS = [
  ['IBM Plex Sans', 400, 'ibm-plex-sans-latin-400-normal'], ['IBM Plex Sans', 500, 'ibm-plex-sans-latin-500-normal'],
  ['IBM Plex Sans', 600, 'ibm-plex-sans-latin-600-normal'], ['IBM Plex Mono', 400, 'ibm-plex-mono-latin-400-normal'],
  ['IBM Plex Mono', 500, 'ibm-plex-mono-latin-500-normal'],
] as const;

let fontCss: Promise<string> | null = null;
/** @font-face rules with the fonts inlined (fetched once from this site; empty if that fails). */
function fonts(): Promise<string> {
  return fontCss ??= Promise.all(FONTS.map(async ([family, weight, file]) => {
    const r = await fetch(`/fonts/${file}.woff2`); if (!r.ok) throw new Error('font');
    const b = new Uint8Array(await r.arrayBuffer());
    let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;src:url(data:font/woff2;base64,${btoa(s)}) format('woff2')}`;
  })).then(r => r.join(''), () => { fontCss = null; return ''; });
}

const frame = () => new Promise<void>(ok => requestAnimationFrame(() => requestAnimationFrame(() => ok())));

/** Copy the computed style of `src` (and its descendants, element by element) onto `dst` as inline styles. */
function inline(src: Element, dst: Element, props: readonly string[] | null, drop = '') {
  const a = [src, ...src.querySelectorAll('*')], b = [dst, ...dst.querySelectorAll('*')];
  for (let i = 0; i < a.length; i++) {
    const cs = getComputedStyle(a[i]), el = b[i] as HTMLElement | SVGElement;
    if (drop && a[i].matches(drop)) { el.setAttribute('data-drop', ''); continue; }
    const names = props ?? Array.from(cs);
    let css = '';
    for (const p of names) { const v = cs.getPropertyValue(p); if (v && v !== 'none' || p === 'display' || p === 'fill' || p === 'stroke') css += `${p}:${v};`; }
    el.setAttribute('style', css);
    el.removeAttribute('class');
  }
}

/** The drawing's bounds in world coordinates: the canvas content plus any notes. */
function bounds(world: SVGGElement, notes: HTMLElement[]) {
  const b = world.getBBox();
  let x0 = b.x, y0 = b.y, x1 = b.x + b.width, y1 = b.y + b.height;
  for (const n of notes) {
    const x = parseFloat(n.style.left) || 0, y = parseFloat(n.style.top) || 0;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + n.offsetWidth); y1 = Math.max(y1, y + n.offsetHeight);
  }
  return { x: x0 - PAD, y: y0 - PAD, w: x1 - x0 + PAD * 2, h: y1 - y0 + PAD * 2 };
}

/** The open diagram as SVG markup, plus its size in CSS px. Throws if there's nothing to export. */
export async function diagramSvg(): Promise<{ svg: string; w: number; h: number }> {
  const stage = document.getElementById('stage');
  const src = stage?.querySelector<SVGSVGElement>(':scope > svg');
  const world = src?.querySelector<SVGGElement>(':scope > g[transform]');
  if (!src || !world) throw new Error('Nothing to export');

  // draw it as it would look to someone else: nothing selected, light theme
  const root = document.documentElement, theme = root.getAttribute('data-theme');
  const sel = editor().selection;
  useEditor.setState({ selection: null });
  root.setAttribute('data-theme', 'light');
  const still = document.createElement('style');   // no transitions: computed colours must be the final ones
  still.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
  document.head.appendChild(still);
  await frame();
  try {
    const noteEls = [...(stage!.querySelectorAll<HTMLElement>('.notes-world .cnote'))];
    // measure without the interaction-only bits (wide hit areas, hidden labels) so the frame hugs the drawing
    const skipped = [...world.querySelectorAll<SVGElement>(DROP)];
    skipped.forEach(e => e.style.setProperty('display', 'none'));
    const box = bounds(world, noteEls);
    skipped.forEach(e => e.style.removeProperty('display'));
    if (!(box.w > PAD * 2 && box.h > PAD * 2)) throw new Error('Nothing to export');

    const svg = src.cloneNode(true) as SVGSVGElement;
    // interaction-only bits (hit areas, ports, handles, cut labels) don't belong in a picture
    inline(src, svg, SVG_PROPS, DROP);
    svg.querySelectorAll('[data-drop]').forEach(e => e.remove());
    // the grid and the infinite background rect go; the world is framed on the drawing
    svg.querySelectorAll('pattern').forEach(p => p.remove());
    svg.querySelector(':scope > rect')?.remove();
    const w2 = svg.querySelector<SVGGElement>(':scope > g[transform]')!;
    w2.setAttribute('transform', `translate(${-box.x} ${-box.y})`);
    w2.style.removeProperty('transform'); w2.style.removeProperty('transform-origin');   // the screen's pan and zoom, copied in as CSS
    for (const a of ['id', 'tabindex', 'aria-label', 'class', 'style']) svg.removeAttribute(a);
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', String(Math.ceil(box.w))); svg.setAttribute('height', String(Math.ceil(box.h)));
    svg.setAttribute('viewBox', `0 0 ${Math.ceil(box.w)} ${Math.ceil(box.h)}`);
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    Object.entries({ width: '100%', height: '100%', fill: '#ffffff' }).forEach(([k, v]) => bg.setAttribute(k, v));
    svg.insertBefore(bg, w2);

    // canvas notes are HTML: carry them over in <foreignObject>, styled inline
    for (const n of noteEls) {
      const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
      const x = parseFloat(n.style.left) || 0, y = parseFloat(n.style.top) || 0;
      Object.entries({ x: String(x), y: String(y), width: String(n.offsetWidth), height: String(n.offsetHeight) }).forEach(([k, v]) => fo.setAttribute(k, v));
      const copy = n.cloneNode(true) as HTMLElement;
      inline(n, copy, null, '[data-resize], .cnote-colours');
      copy.querySelectorAll('[data-drop]').forEach(e => e.remove());
      // placed by the <foreignObject>, so not positioned itself
      for (const k of Array.from(copy.style)) if (/^(position|left|top|right|bottom|inset|translate|transform|margin)/.test(k)) copy.style.removeProperty(k);
      copy.style.setProperty('position', 'relative'); copy.style.setProperty('margin', '0');
      fo.appendChild(copy);
      w2.appendChild(fo);
    }

    // icons are <use href="#ic-…"> pointing at symbols in the page: bring the ones used along
    const defs = svg.querySelector('defs') ?? svg.insertBefore(document.createElementNS('http://www.w3.org/2000/svg', 'defs'), svg.firstChild);
    const used = new Set([...svg.querySelectorAll('use')].map(u => (u.getAttribute('href') ?? u.getAttribute('xlink:href') ?? '').slice(1)).filter(Boolean));
    for (const id of used) { const sym = document.getElementById(id); if (sym && !defs.querySelector('#' + CSS.escape(id))) defs.appendChild(sym.cloneNode(true)); }

    const css = await fonts();
    if (css) {
      const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
      style.textContent = css;
      defs.appendChild(style);
    }
    // notes' HTML must say it's HTML, or the image reads it as unknown SVG and draws nothing
    const out = new XMLSerializer().serializeToString(svg).replace(/(<foreignObject[^>]*>)<div (?!xmlns)/g, '$1<div xmlns="http://www.w3.org/1999/xhtml" ');
    return { svg: out, w: Math.ceil(box.w), h: Math.ceil(box.h) };
  } finally {
    still.remove();
    if (theme === null) root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme);
    useEditor.setState({ selection: sel });
  }
}

/** The open diagram as a PNG at `scale`× (capped so huge diagrams stay within what browsers can draw). */
export async function diagramPng(scale = 2): Promise<Blob> {
  const { svg, w, h } = await diagramSvg();
  const s = Math.min(scale, 16000 / Math.max(w, h), Math.sqrt(64e6 / (w * h)));
  const img = new Image();
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * s); canvas.height = Math.round(h * s);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((ok, fail) => canvas.toBlob(b => (b ? ok(b) : fail(new Error('Couldn’t draw the image'))), 'image/png'));
}

/** Put the diagram on the clipboard as a PNG. The blob is handed over as a promise so Safari keeps the click's permission. */
export async function copyDiagramImage(): Promise<void> {
  const png = diagramPng();
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('This browser can’t copy images — use Download PNG');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}
