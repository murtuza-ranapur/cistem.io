/** A component's logo: choose a file, or paste / drop an image (the canvas handles those too). */
import { useRef, useState } from 'react';
import type { Node } from '../../../domain/model';
import { imageIn } from '../../../lib/logo';
import { Icon } from '../../../ui/Icon';
import { modLabel } from '../../../lib/browser';
import { logoOnto, setLogo } from '../logo';

export function LogoField({ n }: { n: Node }) {
  const picker = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const take = (f: File | null | undefined) => { if (f) void logoOnto([n.id], f); };
  return (
    <div className={'wide logo-field' + (over ? ' over' : '')} id="logoField"
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); e.stopPropagation(); setOver(false); take(imageIn(e.dataTransfer)); }}>
      <span className="lf-label">Logo</span>
      <div className="lf-row">
        <button type="button" className="lf-well" title="Choose an image" aria-label="Choose a logo image" onClick={() => picker.current?.click()}>
          {n.logo ? <img src={n.logo} alt="" /> : <Icon name="ic-image" />}
        </button>
        <div className="lf-text">
          <div>
            <button type="button" className="small" id="logoChoose" onClick={() => picker.current?.click()}>{n.logo ? 'Replace…' : 'Choose image…'}</button>
            {n.logo && <button type="button" className="small" id="logoRemove" onClick={() => setLogo([n.id], null)}>Remove</button>}
          </div>
          <span className="muted">or paste ({modLabel}V) or drop an image onto the component</span>
        </div>
      </div>
      <input ref={picker} type="file" accept="image/*" hidden onChange={e => { take(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}
