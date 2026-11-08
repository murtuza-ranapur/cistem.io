/**
 * Form controls bound to a field of the selected item by path. Every keystroke is saved (the canvas follows
 * as you type); the panel groups a field's edits into one undo step per focus.
 */
import { useState } from 'react';
import { qty } from '../../../domain/model';
import { capitalise } from '../../../lib/format';
import { editItem, renamedRefTarget, retargetRefs, setPath } from './paths';

/** Save a field of the selected item; renaming a table or column moves the foreign keys that point at it. */
export function setField(path: string, value: unknown) {
  editItem((item, doc) => {
    const old = renamedRefTarget(item, path);
    setPath(item, path, value);
    if (old) retargetRefs(doc, item, old, renamedRefTarget(item, path)!);
  });
}

interface Common { path: string; label: string; wide?: boolean }
const Label = ({ label, wide, children, className }: { label: string; wide?: boolean; children: React.ReactNode; className?: string }) => (
  <label className={[className, wide && 'wide'].filter(Boolean).join(' ') || undefined}>{capitalise(label)}{children}</label>
);

/** A text field. `required` fields can't be left blank: emptied, they go back to what they were. */
export function TextField({ path, label, wide, value, placeholder, list, required, onSave = setField }: Common & {
  value: string; placeholder?: string; list?: string; required?: boolean; onSave?: (path: string, v: string) => void;
}) {
  const [before, setBefore] = useState('');
  return (
    <Label label={label} wide={wide}>
      <input data-path={path} type="text" value={value} placeholder={placeholder} list={list}
        onFocus={() => setBefore(value)}
        onChange={e => onSave(path, e.target.value)}
        onBlur={() => { if (required && !value.trim()) onSave(path, before); }} />
    </Label>
  );
}

/** A quantity: stored as you type (never negative — the engine reads junk as 0); the field shows what was stored once you leave it. */
export function NumberField({ path, label, wide, value, min, max, step, onSave = setField }: Common & {
  value: unknown; min?: number; max?: number; step?: number; onSave?: (path: string, v: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Label label={label} wide={wide}>
      <input data-path={path} type="number" step={step ?? 'any'} min={min} max={max}
        value={draft ?? String(value ?? '')}
        onChange={e => { setDraft(e.target.value); onSave(path, qty(e.target.value)); }}
        onBlur={() => setDraft(null)} />
    </Label>
  );
}

/** A select whose options carry their value explicitly, so relabelling an option never changes what it stores. */
export function SelectField({ path, label, wide, value, options, labelOf = o => o, className, empty, int, onSave = setField }: Common & {
  value: string; options: string[]; labelOf?: (o: string) => string; className?: string;
  /** label for an empty option that stores null */
  empty?: string;
  /** store the option as a number (an index) */
  int?: boolean;
  onSave?: (path: string, v: string | number | null) => void;
}) {
  return (
    <Label label={label} wide={wide}>
      <select data-path={path} className={className} value={value}
        onChange={e => { const v = e.target.value; onSave(path, v === '' && (empty !== undefined || int) ? null : int ? +v : v); }}>
        {empty !== undefined && <option value="">{empty}</option>}
        {options.map(o => <option key={o} value={o}>{labelOf(o)}</option>)}
      </select>
    </Label>
  );
}

export function CheckField({ path, label, wide, value }: Common & { value: boolean }) {
  return (
    <label className={'check' + (wide ? ' wide' : '')}>
      <input data-path={path} type="checkbox" checked={value} onChange={e => setField(path, e.target.checked)} />{label}
    </label>
  );
}

/** Small buttons used across the panel. */
export const AddButton = ({ label, onClick, action }: { label: string; onClick: () => void; action: string }) =>
  <button type="button" className="small" data-action={action} onClick={onClick}>+ {label}</button>;
export const RemoveButton = ({ onClick, action }: { onClick: () => void; action: string }) =>
  <button type="button" className="x" data-action={action} aria-label="Remove" onClick={onClick}>×</button>;
export const DataList = ({ id, values }: { id: string; values: string[] }) =>
  <datalist id={id}>{values.map(v => <option key={v} value={v} />)}</datalist>;
