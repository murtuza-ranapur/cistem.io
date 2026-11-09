/** Style rows for the panel: a labelled row, a segmented choice and the colour swatches (environments' palette). */
import type { ReactNode } from 'react';
import { CONTAINER_COLORS, paletteCss, type ContainerColor } from '../../../domain/model';

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function StyleRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="wide look-row"><span className="look-l">{label}</span>{children}</div>;
}

/** One of a few options; `attr` names them for tests (`data-style="line:dotted"`). */
export function Seg<T extends string>({ attr, value, options, onPick }: { attr: string; value: T; options: readonly (readonly [T, ReactNode, string?])[]; onPick(v: T): void }) {
  return (
    <span className="seg look-seg">{options.map(([v, label, aria]) => (
      <button type="button" key={v} data-style={`${attr}:${v}`} className={value === v ? 'on' : ''} aria-pressed={value === v} aria-label={aria} title={aria}
        onClick={() => onPick(v)}>{label}</button>
    ))}</span>
  );
}

/** Default + the palette. `fallback` is the CSS colour "Default" stands for. */
export function Swatches({ attr, value, fallback, defaultLabel, onPick }: { attr: string; value: ContainerColor | undefined; fallback: string; defaultLabel: string; onPick(c: ContainerColor | undefined): void }) {
  const sw = (key: ContainerColor | undefined, css: string, title: string) => {
    const on = value === key;
    return <button type="button" key={key ?? 'default'} className={'swatch' + (on ? ' on' : '') + (key ? '' : ' sw-default')} data-style={`${attr}:${key ?? 'default'}`}
      style={{ '--sw': css } as React.CSSProperties} title={title} aria-label={title} aria-pressed={on} onClick={() => onPick(key)} />;
  };
  return (
    <span className="swatches">
      {sw(undefined, fallback, defaultLabel)}
      {(Object.keys(CONTAINER_COLORS) as ContainerColor[]).map(k => sw(k, paletteCss(k)!, cap(k)))}
    </span>
  );
}
