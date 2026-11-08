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

export function App() {
  const kind = useEditor(s => s.open.kind);
  const Rail = diagram(kind).Rail;
  return (
    <div id="app" data-kind={kind}>
      <Header />
      <TabBar />
      <aside id="rail" aria-label="Components"><Rail /></aside>
      <Stage />
      <Inspector />
      <Drawer />
      <ConflictBanner />
      <Toast />
      <IoDialog />
    </div>
  );
}
