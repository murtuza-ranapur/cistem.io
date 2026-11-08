/** The whole app: header, tabs, the rail of tools, the canvas, the details panel, and the overlays. */
import { useEditor } from '../store/editor';
import { diagram } from '../diagrams';
import { Header } from './Header';
import { TabBar } from './TabBar';
import { Stage } from './Stage';
import { Inspector } from './Inspector';
import { Drawer } from './Drawer';
import { IoDialog } from './IoDialog';
import { ConflictBanner, Toast } from './Banners';
import { NoteButton } from '../notes/NoteButton';
import { Dialogs } from './Dialogs';
import { MenuHost } from './Menu';
import { ShareDialog } from './ShareDialog';

export function App() {
  const kind = useEditor(s => s.open.kind);
  const Rail = diagram(kind).Rail;
  return (
    <div id="app" data-kind={kind}>
      <Header />
      <TabBar />
      <aside id="rail" aria-label="Components"><Rail /><NoteButton /></aside>
      <Stage />
      <Inspector />
      <Drawer />
      <ConflictBanner />
      <Toast />
      <IoDialog />
      <ShareDialog />
      <Dialogs />
      <MenuHost />
    </div>
  );
}
