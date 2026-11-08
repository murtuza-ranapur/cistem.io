/** Messages: the save-conflict banner, toasts at the bottom, and hints over the canvas. */
import { useUi } from '../store/ui';
import { useCloud, resolveConflict } from '../store/cloud';

export function ConflictBanner() {
  const conflict = useCloud(s => s.status === 'conflict');
  if (!conflict) return null;
  return (
    <div id="conflict" className="banner">
      <span>This diagram was changed elsewhere.</span>
      <button type="button" className="small" id="conflictTheirs" onClick={() => resolveConflict('theirs')}>Load theirs</button>
      <button type="button" className="small primary" id="conflictMine" onClick={() => resolveConflict('mine')}>Keep mine</button>
    </div>
  );
}

export function Toast() {
  const text = useUi(s => s.toast);
  return text ? <div id="toast" className="banner">{text}</div> : null;
}

export function Hint() {
  const text = useUi(s => s.hint);
  return text ? <div id="hint">{text}</div> : null;
}
