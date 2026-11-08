/** PLACEHOLDER: the class diagram module (being ported). */
import type { DiagramModule } from '../types';
import { Surface } from '../../ui/Surface';
import { blankCls } from '../../domain/cls';
import { clsToFile } from '../../domain/document';

export const classes: DiagramModule<'class'> = {
  kind: 'class', label: 'class', untitled: 'Untitled classes',
  blank: () => blankCls(),
  toFile: (doc, meta) => clsToFile(doc, meta),
  Canvas: () => <Surface id="classCanvas"><g /></Surface>,
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
