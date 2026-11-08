/** A small badge on a canvas item that has notes: a note icon, plus checklist progress when there is one. */
import { hasNotes, notePreview, taskProgress } from '../domain/notes';

/** `x`, `y`: the badge's top-right corner (it sits on the item's corner). Hovering shows the first lines. */
export function NoteBadge({ md, x, y }: { md: string | undefined; x: number; y: number }) {
  if (!hasNotes(md)) return null;
  const p = taskProgress(md);
  const label = p.total ? `${p.done}/${p.total}` : '';
  const w = 22 + label.length * 6.2;
  return (
    <g className={'note-badge' + (p.total && p.done === p.total ? ' done' : '')} transform={`translate(${x - w + 8} ${y - 9})`} data-badge="notes">
      <title>{notePreview(md, 200)}</title>
      <rect width={w} height={18} rx={9} />
      <path d="M6 5h8v5l-3 3H6z M11 13v-3h3" transform="translate(0 0)" />
      {label && <text x={19} y={13}>{label}</text>}
    </g>
  );
}
