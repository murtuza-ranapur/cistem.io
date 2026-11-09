/** Copy or download the open diagram as an image (lib/exportImage), with feedback. */
import { copyDiagramImage, diagramPng, diagramSvg } from '../lib/exportImage';
import { download, fileName } from '../lib/browser';
import { editor } from './editor';
import { toast as hint } from './ui';

const title = () => editor().meta?.title || 'diagram';

export async function copyImage() {
  try { await copyDiagramImage(); hint('Image copied — paste it into Confluence, a doc or a slide', 2600); }
  catch (e) { hint((e as Error).message || 'Couldn’t copy the image', 3500); }
}
export async function downloadPng() {
  try { download(fileName(title(), '.png'), await diagramPng()); }
  catch (e) { hint((e as Error).message, 3500); }
}
export async function downloadSvg() {
  try { download(fileName(title(), '.svg'), (await diagramSvg()).svg, 'image/svg+xml'); }
  catch (e) { hint((e as Error).message, 3500); }
}
