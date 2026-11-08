/** The class tools on the left: one button per kind (also the 1–5 keys). */
import type { ClassKind } from '../../domain/cls';
import { addClass } from './actions';
import { KIND_COLOR, QUICK } from './model';

const TOOL: Record<ClassKind, { letter: string; label: string; title: string }> = {
  class: { letter: 'C', label: 'Class', title: 'Class' },
  interface: { letter: 'I', label: 'Interface', title: 'Interface' },
  enum: { letter: 'E', label: 'Enum', title: 'Enum' },
  record: { letter: 'R', label: 'Record', title: 'Record' },
  abstract: { letter: 'A', label: 'Abstract', title: 'Abstract class' },
};

export function Rail() {
  return (
    <div id="railCls" className="rail-seq">
      {QUICK.map((kind, i) => {
        const t = TOOL[kind];
        return (
          <button type="button" key={kind} className="comp sq-tool" data-clstool={kind} title={`${t.title} (${i + 1})`} onClick={() => addClass(kind)}>
            <span className="cl-kw" style={{ '--kc': KIND_COLOR[kind], ...(kind === 'abstract' ? { fontStyle: 'italic' } : {}) } as React.CSSProperties}>{t.letter}</span>
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
