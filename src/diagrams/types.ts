/**
 * What every kind of diagram provides. The app shell (header, tabs, panel, keyboard, clipboard, right-click
 * menu) talks to the open diagram only through this, so adding a kind means adding one folder.
 */
import type { ComponentType } from 'react';
import type { DiagramKind, DiagramFile, SequenceFile, ClassFile } from '../domain/document';
import type { DocOf, Meta, Selection } from '../store/editor';
import type { Box, Point } from '../store/viewport';

export interface Verdict { status: 'ok' | 'warn' | 'crit' | 'none'; text: string; detail?: string; /** extra classes for the badge */ className?: string }

export interface DiagramModule<K extends DiagramKind = DiagramKind> {
  kind: K;
  /** "system", "sequence", "class" as shown on tabs. */
  label: string;
  untitled: string;
  /** A new, empty diagram of this kind. */
  blank(): DocOf<K>;
  toFile(doc: DocOf<K>, meta: Meta): AnyFile;

  /** The drawing surface. */
  Canvas: ComponentType;
  /** The left rail (tools to add things). */
  Rail: ComponentType;
  /** The details panel body. */
  Panel: ComponentType;
  /** Extra header items: beside the title (e.g. the system's load) and among the toolbar buttons. */
  HeaderInfo?: ComponentType;
  Tools?: ComponentType;
  /** Whether the panel has something to show for this selection (auto mode opens only then). */
  panelFor(sel: Selection | null): boolean;
  /** The header's status line. */
  verdict(doc: DocOf<K>): Verdict;

  /** Everything drawn, for fit-to-view. */
  bounds(doc: DocOf<K>): Box | null;
  /** Its own fit-to-view, when centring `bounds` isn't right (e.g. a sequence reads from the top). */
  fit?(animated: boolean): void;
  /** The selected item's box, so the view can keep it clear of the panel. */
  selectionBox?(doc: DocOf<K>, sel: Selection): Box | null;
  /** What a right-click on `target` should select (null: empty canvas). */
  selectionAt(target: Element): Selection | null;

  /** The + menu's "Made from this diagram" section (null: nothing to make). */
  madeFrom?(): MadeFrom | null;

  /** Keys this diagram handles (after the app's own). Return true when handled. */
  keydown?(ev: KeyboardEvent): boolean;
  remove(): void;
  duplicate(): void;
  selectAll(): void;
  organise?(): void;

  /** The selection as clipboard text, or null when nothing copyable is selected. */
  copy(): string | null;
  /** Paste text (from this app or elsewhere). False when this kind can't use it. */
  paste(text: string, at: Point | null, repeat: number): boolean;
}

export interface MadeFrom {
  title: string;
  /** A sequence from a request path, starting at this component (null: no starting point). */
  pathStart: string | null;
  fromPath(): void;
  /** Other diagrams that can be made (e.g. a class diagram from a database's tables). */
  extra: { label: string; run(): void }[];
}
export type AnyFile = DiagramFile | SequenceFile | ClassFile;
