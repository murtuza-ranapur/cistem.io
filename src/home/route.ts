/**
 * Home page or app. The home page is at `/`, the app at `/app`. A first visit shows the home page; once someone
 * has entered the app (signed in, or chose to try it without an account) that is remembered in this browser and
 * `/` opens the app directly. Links to a diagram or project (?d= ?s= ?p=) always open the app.
 */
import { create } from 'zustand';
import { storage } from '../lib/browser';

const KEY = 'cistem.entered';
export const remembered = () => storage.get(KEY) === '1';
const remember = () => { storage.set(KEY, '1'); };

interface RouteState {
  view: 'home' | 'app';
  /** The home page is showing because nothing said otherwise (not because someone asked for it). */
  auto: boolean;
  /** This browser's diagrams have been read (the home page can count them). */
  ready: boolean;
}

const session = { get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } }, remove: (k: string) => { try { sessionStorage.removeItem(k); } catch { /* ignore */ } } };
const appPath = () => location.pathname === '/app' || location.pathname.startsWith('/app/');
/** Put the app's address in the bar, keeping the query (?d= and friends). */
function addressApp(push: boolean) {
  if (appPath()) return;
  const to = '/app' + location.search + location.hash;
  if (push) window.history.pushState(null, '', to); else window.history.replaceState(null, '', to);
}

function initial(): RouteState {
  const q = new URL(location.href).searchParams;
  const linked = q.has('d') || q.has('s') || q.has('p');
  const failed = q.get('login') === 'failed';
  if (failed && !remembered()) session.remove('cistem.returnTo');
  const back = session.get('cistem.returnTo') !== null;   // on the way back from GitHub
  const known = appPath() || remembered() || (back && !failed);
  if (known) remember();
  if (known || linked) { addressApp(false); return { view: 'app', auto: false, ready: false }; }
  return { view: 'home', auto: true, ready: false };
}

export const useRoute = create<RouteState>(initial);
export const atHome = () => useRoute.getState().view === 'home';
export const markReady = () => useRoute.setState({ ready: true });

/** Into the app (from the home page's buttons), remembered for next time. */
export function enterApp() {
  remember();
  addressApp(true);
  useRoute.setState({ view: 'app', auto: false });
}
/** This browser turns out to have been here before (an account, or diagrams kept here): skip the home page. */
export function enterIfAuto() {
  const s = useRoute.getState();
  if (s.view === 'app') { if (appPath()) remember(); return; }
  if (!s.auto) return;
  remember();
  addressApp(false);
  useRoute.setState({ view: 'app', auto: false });
}
/** To the home page because someone asked (the logo). */
export function goHome() {
  if (location.pathname !== '/') window.history.pushState(null, '', '/');
  useRoute.setState({ view: 'home', auto: false });
}
/** After signing out: the home page as a first visit sees it. */
export function leaveToHome() {
  storage.remove(KEY);
  window.history.replaceState(null, '', '/');
  useRoute.setState({ view: 'home', auto: false });
}

window.addEventListener('popstate', () => useRoute.setState({ view: appPath() ? 'app' : 'home', auto: false }));
// while the home page is up, the editor underneath hears no keys and no clipboard
for (const type of ['keydown', 'copy', 'cut', 'paste'] as const) {
  document.addEventListener(type, ev => { if (atHome()) ev.stopImmediatePropagation(); }, true);
}
