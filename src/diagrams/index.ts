/** The kinds of diagram, by name. */
import type { DiagramKind } from '../domain/document';
import type { DiagramModule } from './types';
import { system } from './system';
import { sequence } from './sequence';
import { classes } from './class';

const MODULES: { [K in DiagramKind]: DiagramModule<K> } = { system, sequence, class: classes };

export const diagram = <K extends DiagramKind>(kind: K): DiagramModule<K> => MODULES[kind];
