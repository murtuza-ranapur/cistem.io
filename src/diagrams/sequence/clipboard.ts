/**
 * Copy and paste in a sequence: the selection travels as the text format, so it pastes into any sequence and
 * reads in any text editor. Text, Mermaid and PlantUML from elsewhere paste too.
 */
import { blockEnd, parseSeq, printSeq, rowId, slugId, type Participant, type Row } from '../../domain/seq';
import { change, editor, select } from '../../store/editor';
import { hint } from '../../store/ui';
import { docOf } from '../shared';

const MARK = '# cistem copy';

/** The selected lifeline, or the selected messages/notes/blocks (with the lifelines they use), as text. */
export function copySequence(): string | null {
  const d = docOf('sequence'), s = editor().selection;
  if (s?.type === 'part') {
    const p = d.participants.find(x => x.id === s.ids[0]);
    return p ? `${MARK}\n${printSeq({ participants: [p], rows: [] })}` : null;
  }
  if (s?.type !== 'row') return null;
  const ids = new Set(s.ids), take = new Set<number>();
  d.rows.forEach((r, i) => {
    if (!ids.has(r.id)) return;
    if (r.t === 'open') { for (let k = i, e = blockEnd(d.rows, i); k <= e; k++) take.add(k); }
    else if (r.t === 'msg' || r.t === 'note') take.add(i);
  });
  if (!take.size) return null;
  const rows = [...take].sort((a, b) => a - b).map(i => d.rows[i]);
  const used = new Set(rows.flatMap(r => (r.t === 'msg' ? [r.from, r.to] : r.t === 'note' ? r.over : [])));
  return `${MARK}\n${printSeq({ participants: d.participants.filter(p => used.has(p.id)), rows })}`;
}

/**
 * Paste rows below the selected row (after a selected block's end) or at the end, adding lifelines they need.
 * A lifeline pasted on its own is a new lifeline. False when the text has nothing for a sequence.
 */
export function pasteSequence(text: string): boolean {
  const p = parseSeq(text);
  if (p.errors.length) { hint(`Couldn't paste: line ${p.errors[0].line + 1} — ${p.errors[0].message}`, 2600); return true; }
  if (!p.doc.participants.length && !p.doc.rows.length) return false;
  const d = docOf('sequence'), s = editor().selection;
  const alone = !p.doc.rows.length;
  const taken = d.participants.map(y => y.id), map: Record<string, string> = {}, added: Participant[] = [];
  for (const x of p.doc.participants) {
    if (!alone && taken.includes(x.id)) { map[x.id] = x.id; continue; }
    const id = taken.includes(x.id) ? slugId(x.id, taken) : x.id;
    taken.push(id); map[x.id] = id; added.push({ ...x, id });
  }
  const rows: Row[] = p.doc.rows.map(r => {
    const c = { ...r, id: rowId() } as Row;
    if (c.t === 'msg') { c.from = map[c.from] ?? c.from; c.to = map[c.to] ?? c.to; }
    if (c.t === 'note') c.over = c.over.map(o => map[o] ?? o);
    return c;
  });
  const i = s?.type === 'row' ? d.rows.findIndex(r => r.id === s.ids[0]) : -1;
  const at = i < 0 ? d.rows.length : d.rows[i].t === 'open' ? blockEnd(d.rows, i) + 1 : i + 1;
  change('sequence', dd => { dd.participants.push(...added); dd.rows.splice(at, 0, ...rows); });
  const newRows = rows.filter(r => r.t !== 'close' && r.t !== 'else').map(r => r.id);
  if (alone && added.length) select({ type: 'part', ids: [added[0].id] });
  else if (newRows.length) select({ type: 'row', ids: newRows });
  return true;
}
