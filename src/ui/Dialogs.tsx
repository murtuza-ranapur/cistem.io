/**
 * Asking the user something in a dialog: `confirmDialog` (optionally making them type a name first, for
 * things that can't be undone) and `promptDialog` (one line of text). Both resolve when the dialog closes.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';

interface Confirm { kind: 'confirm'; title: string; body?: ReactNode; confirm: string; danger?: boolean; typeToConfirm?: string }
interface Prompt { kind: 'prompt'; title: string; label: string; value?: string; confirm: string; placeholder?: string }
type Ask = (Confirm | Prompt) & { done(v: boolean | string | null): void };

const useAsk = create(() => ({ ask: null as Ask | null }));

export const confirmDialog = (a: Omit<Confirm, 'kind'>) =>
  new Promise<boolean>(res => useAsk.setState({ ask: { ...a, kind: 'confirm', done: v => res(v === true) } }));
export const promptDialog = (a: Omit<Prompt, 'kind'>) =>
  new Promise<string | null>(res => useAsk.setState({ ask: { ...a, kind: 'prompt', done: v => res(typeof v === 'string' ? v : null) } }));

export function Dialogs() {
  const ask = useAsk(s => s.ask);
  return ask ? <AskDialog key={ask.title} ask={ask} /> : null;
}

function AskDialog({ ask }: { ask: Ask }) {
  const [text, setText] = useState(ask.kind === 'prompt' ? ask.value ?? '' : '');
  const field = useRef<HTMLInputElement>(null), ok = useRef<HTMLButtonElement>(null);
  useEffect(() => { (field.current ?? ok.current)?.focus(); field.current?.select(); }, []);
  const finish = (v: boolean | string | null) => { useAsk.setState({ ask: null }); ask.done(v); };
  const typed = ask.kind === 'confirm' && ask.typeToConfirm;
  const ready = ask.kind === 'prompt' ? !!text.trim() : !typed || text.trim() === ask.typeToConfirm;
  const submit = () => { if (ready) finish(ask.kind === 'prompt' ? text.trim() : true); };
  return (
    <Modal label={ask.title} onClose={() => finish(null)}>
      <form className="dlg-body" onSubmit={e => { e.preventDefault(); submit(); }}>
        <h2>{ask.title}</h2>
        {ask.kind === 'confirm' && ask.body}
        {ask.kind === 'prompt' && (
          <label className="dlg-field">{ask.label}
            <input ref={field} id="dlgInput" type="text" maxLength={200} value={text} placeholder={ask.placeholder} onChange={e => setText(e.target.value)} />
          </label>
        )}
        {typed && (
          <label className="dlg-field">Type <b>{ask.typeToConfirm}</b> to confirm
            <input ref={field} id="dlgInput" type="text" value={text} autoComplete="off" onChange={e => setText(e.target.value)} />
          </label>
        )}
        <div className="dlg-actions">
          <button type="button" id="dlgCancel" onClick={() => finish(null)}>Cancel</button>
          <button type="submit" id="dlgOk" ref={ok} className={ask.kind === 'confirm' && ask.danger ? 'danger' : 'primary'} disabled={!ready}>{ask.confirm}</button>
        </div>
      </form>
    </Modal>
  );
}

/** A centred dialog over a dimmed page; Escape or a click outside closes it. */
export function Modal({ label, onClose, children, id }: { label: string; onClose(): void; children: ReactNode; id?: string }) {
  return (
    <div className="modal" id={id} onPointerDown={e => e.target === e.currentTarget && onClose()} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <div className="dlg" role="dialog" aria-modal="true" aria-label={label}>{children}</div>
    </div>
  );
}
