/** The whole app: header, tabs, the rail of tools, the canvas, the details panel, and the overlays. */
import { useEditor } from '../store/editor';
import { Header } from './Header';
import { TabBar } from './TabBar';
import { Stage } from './Stage';
import { Inspector } from './Inspector';
import { Drawer } from './Drawer';
import { IoDialog } from './IoDialog';
import { ConflictBanner, Toast } from './Banners';
import { Dialogs } from './Dialogs';
import { MenuHost } from './Menu';
import { ShareDialog } from './ShareDialog';
import { useRoute } from '../home/route';

export function App() {
  const kind = useEditor(s => s.open.kind);
  const home = useRoute(s => s.view === 'home');   // covered by the home page: out of reach, not unmounted
  return (
    <div id="app" data-kind={kind} inert={home} aria-hidden={home || undefined}>
      <Header />
      <TabBar />
      <Stage />
      <Inspector />
      <Drawer />
      <ConflictBanner />
      {!home && <Toast />}
      <IoDialog />
      <ShareDialog />
      <Dialogs />
      <MenuHost />
    </div>
  );
}
