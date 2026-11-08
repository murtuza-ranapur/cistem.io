/** Sequence keys: Enter edits, ↑/↓ move rows, ←/→ move lifelines, P C A R N L pick tools. */
import { hasMod } from '../../lib/browser';
import { editor } from '../../store/editor';
import { docOf } from '../shared';
import { moveParticipant, moveRows, seqTool, spanOf } from './actions';
import { startEdit, startEditPart } from './edit';

const TOOL_KEYS: Record<string, string> = { p: 'participant', c: 'sync', a: 'async', r: 'reply', n: 'note', l: 'loop' };

export function seqKeydown(ev: KeyboardEvent): boolean {
  const s = editor().selection, d = docOf('sequence'), mod = hasMod(ev);
  if (ev.key === 'Enter' && s) { (s.type === 'row' ? startEdit : startEditPart)(s.ids[0]); return true; }
  if ((ev.key === 'ArrowUp' || ev.key === 'ArrowDown') && s?.type === 'row') {
    const i = d.rows.findIndex(r => r.id === s.ids[0]), span = spanOf(d.rows, i);
    // stepping past a neighbouring block marker moves in or out of that block (allowed while it stays balanced)
    const to = ev.key === 'ArrowUp' ? i - 1 : i + span + 1;
    if (span && to >= 0 && to <= d.rows.length) moveRows(d.rows[i].id, span, to);
    return true;
  }
  if ((ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') && s?.type === 'part') {
    const i = d.participants.findIndex(p => p.id === s.ids[0]);
    moveParticipant(s.ids[0], i + (ev.key === 'ArrowLeft' ? -1 : 1));
    return true;
  }
  const tool = !mod && !ev.altKey ? TOOL_KEYS[ev.key.toLowerCase()] : undefined;
  if (tool) { seqTool(tool); return true; }
  return false;
}
