/** Putting logos on components: paste or drop an image onto one, or onto the canvas for a new Application. */
import { nameFromFile, toLogo } from '../../lib/logo';
import { hint } from '../../store/ui';
import * as history from '../../store/history';
import { NODE_H, typeDef } from '../../domain/model';
import type { Point } from '../../store/viewport';
import { addNode } from './actions';
import { edit } from './state';

export function setLogo(ids: string[], logo: string | null) {
  edit(d => { for (const n of d.nodes) if (ids.includes(n.id)) { if (logo) n.logo = logo; else delete n.logo; } });
}

/** Put `file` on these components. */
export async function logoOnto(ids: string[], file: Blob) {
  try { setLogo(ids, await toLogo(file)); hint(ids.length > 1 ? `Logo added to ${ids.length} components` : 'Logo added', 1400); }
  catch (e) { hint((e as Error).message, 3000); }
}

/** A new service (type Application) wearing `file` and named after it, centred on `at` or in the middle of the view. */
export async function appFromLogo(file: File, at: Point | null) {
  let logo: string;
  try { logo = await toLogo(file); } catch (e) { hint((e as Error).message, 3000); return; }
  const name = nameFromFile(file.name);
  history.transaction(() => {
    const n = at ? addNode('service', at.x - typeDef('service').w / 2, at.y - NODE_H / 2) : addNode('service');
    edit(d => { const x = d.nodes.find(m => m.id === n.id); if (x) { x.logo = logo; x.variant = 'Application'; if (name) x.name = name; } });
    return true;
  });
}
