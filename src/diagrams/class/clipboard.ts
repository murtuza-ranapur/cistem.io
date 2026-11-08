/**
 * Copying classes: the selected classes and the relations between them, as the class text format headed by
 * `%% cistem copy {positions}`. Pasting that adds copies (taken names become NameCopy, NameCopy2…).
 * Anything else pasted (Java, Kotlin, Mermaid) is left to the canvas's import.
 */
import { boxSize, parseCls, printCls, relId, type ClassBox, type ClassDoc } from '../../domain/cls';
import { change, select } from '../../store/editor';
import { hint } from '../../store/ui';
import { docOf } from '../shared';
import { selectedClasses } from './actions';
import { copyName, hasClass } from './model';

const MARK = '%% cistem copy';

export function copy(): string | null {
  const d = docOf('class'), names = new Set(selectedClasses());
  if (!names.size) return null;
  const sub: ClassDoc = { classes: d.classes.filter(c => names.has(c.name)), relations: d.relations.filter(r => names.has(r.from) && names.has(r.to)), pos: {} };
  const pos = Object.fromEntries([...names].filter(n => d.pos[n]).map(n => [n, d.pos[n]]));
  return `${MARK} ${JSON.stringify(pos)}\n` + printCls(sub);
}

export function paste(text: string, repeat: number): boolean {
  const first = text.split('\n', 1)[0];
  if (!first.startsWith(MARK)) return false;
  let pos: Record<string, { x: number; y: number }> = {};
  try { pos = JSON.parse(first.slice(MARK.length).trim() || '{}'); } catch { /* positions are optional */ }
  const p = parseCls(text);
  if (p.errors.length || !p.doc.classes.length) { hint(p.errors[0] ? `Couldn't paste: ${p.errors[0].message}` : 'Nothing to paste', 2400); return true; }

  const d = docOf('class'), rename: Record<string, string> = {};
  const taken = (n: string) => hasClass(d, n) || Object.values(rename).includes(n);
  for (const c of p.doc.classes) rename[c.name] = taken(c.name) ? copyName(taken, c.name) : c.name;
  const names = Object.values(rename);
  change('class', draft => {
    let i = 0;
    for (const c of p.doc.classes) {
      const name = rename[c.name], o = pos[c.name], s = boxSize(c);
      draft.classes.push({ ...(c as ClassBox), name });
      draft.pos[name] = o ? { x: o.x + 32 * repeat, y: o.y + 32 * repeat } : { x: 40 + (i++) * (s.w + 40), y: 40 };
    }
    for (const r of p.doc.relations) draft.relations.push({ ...r, id: relId(), from: rename[r.from] ?? r.from, to: rename[r.to] ?? r.to });
  });
  select({ type: 'class', ids: names });
  return true;
}
