/** PLACEHOLDER: the system diagram module (being ported). */
import type { DiagramModule } from '../types';
import { Surface } from '../../ui/Surface';
import { adopt, makeNode } from '../../domain/model';
import { toFile } from '../../domain/document';
const blankSystem = () => adopt({ nodes: [makeNode('entry', 80, 200)], edges: [], containers: [], links: [], frames: {}, detail: {} });

export const system: DiagramModule<'system'> = {
  kind: 'system', label: 'system', untitled: 'Untitled system',
  blank: () => blankSystem(),
  toFile: (doc, meta) => toFile(doc, meta),
  Canvas: () => <Surface id="systemCanvas"><g /></Surface>,
  Rail: () => null,
  Panel: () => null,
  panelFor: sel => !!sel,
  verdict: () => ({ status: 'none', text: '' }),
  bounds: () => null,
  selectionAt: () => null,
  remove() {}, duplicate() {}, selectAll() {},
  copy: () => null,
  paste: () => false,
};
