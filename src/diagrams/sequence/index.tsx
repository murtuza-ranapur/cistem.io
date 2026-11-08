/** PLACEHOLDER: the sequence diagram module (being ported). */
import type { DiagramModule } from '../types';
import { Surface } from '../../ui/Surface';
import { blankSeq } from '../../domain/seq';
import { seqToFile } from '../../domain/document';

export const sequence: DiagramModule<'sequence'> = {
  kind: 'sequence', label: 'sequence', untitled: 'Untitled sequence',
  blank: () => blankSeq(),
  toFile: (doc, meta) => seqToFile(doc, meta),
  Canvas: () => <Surface id="sequenceCanvas"><g /></Surface>,
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
