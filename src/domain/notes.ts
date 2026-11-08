/**
 * Notes: rich text written in markdown. Two kinds:
 * - canvas notes, boxes placed on any diagram (`notes` on the document, geometry in the file's layout);
 * - item notes, a `notes` field on a component, connection, environment, class, relation or lifeline.
 *
 * Note text is markdown (GitHub flavour plus ==highlight==, ++underline++, and <mark>/<span> tags for
 * colours). It's untrusted like the rest of a file: the editor parses it into its own schema, so markup
 * it doesn't know never reaches the page.
 */

export const NOTE_COLORS = ['yellow', 'blue', 'green', 'pink', 'grey', 'none'] as const;
export type NoteColor = typeof NOTE_COLORS[number];

export interface CanvasNote {
  id: string;
  x: number;
  y: number;
  /** Width; the height follows the text unless `h` is set (resized by hand). */
  w: number;
  h?: number;
  color: NoteColor;
  /** Markdown. */
  text: string;
}
/** How a canvas note is stored in a file: content in the model, geometry in the layout. */
export interface NoteFile { model: { id: string; color: NoteColor; text: string }[]; layout: Record<string, { x: number; y: number; w: number; h?: number }> }

export const NOTE_SIZE = { w: 280, minW: 160, maxW: 1200, minH: 60, maxH: 4000 };
/** Longer text is cut: a note is a note, and this keeps files and the editor responsive. */
export const NOTE_MAX_CHARS = 50_000;

export function noteToFile(notes: readonly CanvasNote[] | undefined): NoteFile | null {
  if (!notes?.length) return null;
  const layout: NoteFile['layout'] = {};
  const model = notes.map(n => {
    layout[n.id] = { x: n.x, y: n.y, w: n.w, ...(n.h ? { h: n.h } : {}) };
    return { id: n.id, color: n.color, text: n.text };
  });
  return { model, layout };
}

/** Notes text from an untrusted file: a string, within the size limit, without control characters. */
export function cleanNoteText(v: unknown): string {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, NOTE_MAX_CHARS);
}
/** An item's `notes` field from an untrusted file: kept only when it's non-empty text. */
export function itemNotes(v: unknown): { notes?: string } {
  const t = cleanNoteText(v);
  return t.trim() ? { notes: t } : {};
}

/** Canvas notes from an untrusted file (model.notes + layout.notes). */
export function sanitizeNotes(model: unknown, layout: unknown): CanvasNote[] {
  const list = Array.isArray(model) ? model : [];
  const geo = (layout && typeof layout === 'object' ? layout : {}) as Record<string, unknown>;
  const num = (v: unknown, d: number, lo = -1e6, hi = 1e6) => { const x = Number(v); return v !== null && v !== '' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
  const seen = new Set<string>();
  const out: CanvasNote[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    let id = String(o.id ?? '').replace(/[^\w.:-]/g, '');
    if (!id || seen.has(id)) id = freshNoteId(seen);
    seen.add(id);
    const g = (geo[String(o.id)] && typeof geo[String(o.id)] === 'object' ? geo[String(o.id)] : {}) as Record<string, unknown>;
    const h = num(g.h, 0, 0, NOTE_SIZE.maxH);
    out.push({
      id,
      x: num(g.x, 0), y: num(g.y, 0),
      w: num(g.w, NOTE_SIZE.w, NOTE_SIZE.minW, NOTE_SIZE.maxW),
      ...(h >= NOTE_SIZE.minH ? { h } : {}),
      color: NOTE_COLORS.includes(o.color as NoteColor) ? o.color as NoteColor : 'yellow',
      text: cleanNoteText(o.text),
    });
  }
  return out;
}

export function freshNoteId(taken: Iterable<string>): string {
  const used = new Set(taken);
  let i = used.size + 1;
  while (used.has('note' + i)) i++;
  return 'note' + i;
}

/** Checklist progress in a note: `- [x]` done out of all `- [ ]` / `- [x]` items. */
export function taskProgress(md: string | undefined): { done: number; total: number } {
  let done = 0, total = 0;
  for (const m of (md ?? '').matchAll(/^\s*[-*+] \[([ xX])\]/gm)) { total++; if (m[1] !== ' ') done++; }
  return { done, total };
}

/** The note as one line of plain text (for tooltips and previews). */
export function notePreview(md: string | undefined, max = 140): string {
  const text = (md ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(#{1,6}|>|[-*+](?: \[[ xX]\])?|\d+\.)\s+/gm, '')
    .replace(/[*_~=`+]{1,3}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

export const hasNotes = (md: string | undefined) => !!md && md.trim().length > 0;

/** Box around canvas notes (height estimated when it follows the text). */
export function notesBounds(notes: readonly CanvasNote[] | undefined): { x: number; y: number; w: number; h: number }[] {
  return (notes ?? []).map(n => ({ x: n.x, y: n.y, w: n.w, h: n.h ?? estimateHeight(n) }));
}
export function estimateHeight(n: CanvasNote): number {
  const lines = (n.text.match(/\n/g)?.length ?? 0) + 1;
  return Math.min(NOTE_SIZE.maxH, Math.max(NOTE_SIZE.minH, 36 + lines * 22));
}
