/**
 * Logos on components: any image the browser can read (PNG, JPEG, WebP, GIF, SVG…) becomes a small data: URL,
 * at most LOGO_PX on its longest side, so it lives inside the diagram file (no uploads, works signed out).
 */
export const LOGO_PX = 64;
/** Longest data: URL kept; anything larger is dropped when a file is read. */
export const MAX_LOGO = 60_000;

/** A logo this app wrote: a raster data: URL of a sane size (SVG is rasterised first, so never stored). */
export const isLogo = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= MAX_LOGO && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(v);

export const isImageFile = (f: File | Blob | null | undefined): f is File => !!f && /^image\//.test(f.type);

/** The first image among pasted or dropped files. */
export function imageIn(list: DataTransfer | null | undefined): File | null {
  if (!list) return null;
  for (const f of Array.from(list.files ?? [])) if (isImageFile(f)) return f;
  for (const it of Array.from(list.items ?? [])) if (it.kind === 'file' && /^image\//.test(it.type)) { const f = it.getAsFile(); if (f) return f; }
  return null;
}

const asDataUrl = (blob: Blob) => new Promise<string>((ok, fail) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result)); r.onerror = () => fail(new Error('Couldn’t read that image'));
  r.readAsDataURL(blob);
});

/** Shrink an image to a logo. Throws with a readable message when it isn't one. */
export async function toLogo(blob: Blob): Promise<string> {
  if (!isImageFile(blob)) throw new Error('That isn’t an image');
  if (blob.size > 15_000_000) throw new Error('That image is too big (15 MB max)');
  // read as a data: URL rather than a blob: URL — the page's content policy allows data: images only
  const img = new Image();
  img.src = await asDataUrl(blob);
  try { await img.decode(); } catch { throw new Error('Couldn’t read that image'); }
  const w0 = img.naturalWidth || LOGO_PX, h0 = img.naturalHeight || LOGO_PX;
  const s = Math.min(1, LOGO_PX / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * s)), h = Math.max(1, Math.round(h0 * s));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Couldn’t read that image');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  for (const [type, q] of [['image/png', undefined], ['image/webp', 0.9], ['image/jpeg', 0.85]] as const) {
    const url = canvas.toDataURL(type, q);
    if (isLogo(url)) return url;
  }
  throw new Error('Couldn’t shrink that image');
}

/** "stripe-logo.png" → "Stripe" (a name for a component made from a dropped logo). */
export function nameFromFile(name: string): string {
  const base = name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').replace(/\b(logo|icon|mark|vector|symbol)\b/gi, '').replace(/\s+/g, ' ').trim();
  return base ? base[0].toUpperCase() + base.slice(1) : '';
}
