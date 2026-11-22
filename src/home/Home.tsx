/**
 * The home page: the moon, star trails, what cistem.dev is, and the way in. Three versions of the way in:
 * a first visit (sign up, or try it without an account), signed in (open my diagrams), and no account but
 * diagrams kept in this browser (continue with them).
 */
import { useEffect, useMemo, useRef } from 'react';
import { useCloud, signIn } from '../store/cloud';
import { signOutHere } from '../store/projects';
import * as local from '../store/local';
import { Toast } from '../ui/Banners';
import { enterApp, remembered, useRoute } from './route';
import { startTrails } from './trails';
import './home.css';

const REPO = 'https://github.com/Murtuza-ranapur/cistem.io';
const GITHUB = 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z';
const Octocat = () => <svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor" aria-hidden="true"><path d={GITHUB} /></svg>;

/** Small stars that twinkle at their own pace (placed once). */
function Twinkles() {
  const stars = useMemo(() => Array.from({ length: 110 }, (_, i) => {
    const r = (n: number) => { const x = Math.sin((i + 1) * 12.9898 + n * 78.233) * 43758.5453; return x - Math.floor(x); };
    const size = [1, 1, 1, 2, 2, 3][Math.floor(r(1) * 6)];
    return { left: `${r(2) * 100}%`, top: `${r(3) * 100}%`, width: size, height: size, animationDelay: `${(r(4) * 4).toFixed(2)}s`, animationDuration: `${(2.5 + r(5) * 3).toFixed(2)}s` };
  }), []);
  return <div className="hm-twinkles" aria-hidden="true">{stars.map((s, i) => <i key={i} style={s} />)}</div>;
}

function Moon({ at }: { at: React.RefObject<HTMLDivElement | null> }) {
  const lit = 'M170,-12 A182,182 0 0 1 170,352 A70,182 0 0 0 170,-12Z', fuller = 'M170,-12 A182,182 0 0 1 170,352 A96,182 0 0 0 170,-12Z';
  return (
    <div className="hm-sky" aria-hidden="true">
      <div className="hm-halo" />
      <div className="hm-moon" ref={at}>
        <span style={{ left: '20.5%', top: '24.7%', width: '16.5%', height: '16.5%' }} />
        <span style={{ left: '41%', top: '57.6%', width: '10%', height: '10%' }} />
        <span style={{ left: '15.3%', top: '60.6%', width: '7%', height: '7%' }} />
        <span style={{ left: '49.4%', top: '17.6%', width: '6%', height: '6%' }} />
        <span style={{ left: '33%', top: '77%', width: '4.7%', height: '4.7%' }} />
        <svg viewBox="0 0 340 340">
          <defs><filter id="hmBlur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="7" /></filter></defs>
          <path filter="url(#hmBlur)" fill="#0b0f1e" fillOpacity=".95" d={lit}>
            <animate attributeName="d" dur="14s" repeatCount="indefinite" values={`${lit};${fuller};${lit}`} />
          </path>
        </svg>
      </div>
    </div>
  );
}

/** The way in: which of the three versions depends on the account and on what this browser remembers. */
function WayIn() {
  const user = useCloud(s => s.user);
  const ready = useRoute(s => s.ready);
  if (user) {
    return (
      <div className="hm-cta" data-version="account">
        <div className="hm-who">{user.avatarUrl ? <img alt="" width={28} height={28} src={user.avatarUrl} /> : null}<span>Signed in as <b>{user.login}</b></span></div>
        <button type="button" id="homeOpen" className="hm-btn go" onClick={enterApp}>Open my diagrams <span aria-hidden="true">→</span></button>
        <span className="hm-alt"><button type="button" id="homeSignOut" className="hm-link" onClick={() => void signOutHere()}>Sign out</button></span>
      </div>
    );
  }
  if (remembered()) {
    const n = ready ? local.localProjects().reduce((sum, p) => sum + local.docsOf(p.id).length, 0) : 0;
    return (
      <div className="hm-cta" data-version="browser">
        <button type="button" id="homeOpen" className="hm-btn go" onClick={enterApp}>{n ? `Continue with ${n} diagram${n === 1 ? '' : 's'}` : 'Continue to the app'} <span aria-hidden="true">→</span></button>
        <span className="hm-alt">kept in this browser only</span>
        <button type="button" id="homeSignUp" className="hm-btn small" onClick={signIn}><Octocat /> Sign up to save them</button>
      </div>
    );
  }
  return (
    <div className="hm-cta" data-version="first">
      <button type="button" id="homeSignUp" className="hm-btn sheen" onClick={signIn}><Octocat /> Sign up with GitHub</button>
      <span className="hm-alt">Sign in to save and share diagrams. We only read your GitHub profile.</span>
      <span className="hm-alt">or <button type="button" id="homeTry" className="hm-link" onClick={enterApp}>try it first, no account</button>: diagrams stay in your browser</span>
    </div>
  );
}

const SHOTS = [
  { cls: 'l', img: 'class', bar: 'Diagram tool · class', cap: <><b>Class diagrams</b> from Java, Kotlin or Mermaid</>, alt: 'A class diagram of a diagram tool: Project, Diagram and its three kinds, Component, Connection and Note' },
  { cls: 'c', img: 'system', bar: 'Notification system · load view', cap: <><b>System diagrams</b> that name the first thing to break</>, alt: 'A notification system at 4,000 requests a second: the SMS sender is at 200% and marked in red' },
  { cls: 'r', img: 'sequence', bar: 'Bank reconciliation · sequence', cap: <><b>Sequence diagrams</b> as code or by hand</>, alt: 'A sequence diagram of nightly bank reconciliation, with a loop and an exact or partial match branch' },
];

export function Home() {
  const canvas = useRef<HTMLCanvasElement>(null), moon = useRef<HTMLDivElement>(null);
  useEffect(() => (canvas.current && moon.current ? startTrails(canvas.current, moon.current) : undefined), []);
  return (
    <div id="home" className="home">
      <header className="hm-hero">
        <Twinkles />
        <canvas className="hm-trails" ref={canvas} aria-hidden="true" />
        <div className="hm-shoot" aria-hidden="true" />
        <Moon at={moon} />
        <div className="hm-brand">
          <h1>cistem<span>.dev</span></h1>
          <p>System design that shows where it breaks.</p>
          <p className="sub">Draw system, sequence and class diagrams, then see how much traffic the design can take.</p>
        </div>
        <WayIn />
      </header>
      <section className="hm-shots" aria-label="Examples">
        {SHOTS.map(s => (
          <figure key={s.img} className={'hm-shot ' + s.cls}>
            <div className="frame">
              <div className="bar" aria-hidden="true"><i /><i /><i /><span>{s.bar}</span></div>
              <img src={`/home/${s.img}.jpg`} alt={s.alt} width={1600} height={1000} loading="lazy" decoding="async" />
            </div>
            <figcaption>{s.cap}</figcaption>
          </figure>
        ))}
      </section>
      <section className="hm-feats">
        <div><span aria-hidden="true">⚡</span><h2>Capacity model</h2><p>Traffic flows through every connection: caches, partitions, consumer lag.</p></div>
        <div><span aria-hidden="true">🧭</span><h2>Three kinds</h2><p>System, sequence and class diagrams, from the same components.</p></div>
        <div><span aria-hidden="true">📋</span><h2>Made to share</h2><p>Copy as image into Confluence, or a read-only link.</p></div>
        <div><span aria-hidden="true">✦</span><h2>Works with Claude</h2><p>Add <code>cistem.dev/mcp</code> as a connector and ask Claude to draw it.</p></div>
      </section>
      <footer className="hm-foot">
        <div className="row">
          <b>cistem<span>.dev</span></b>
          <nav aria-label="More">
            <a href={`${REPO}#mcp-server`} target="_blank" rel="noreferrer">Use with Claude</a>
            <a href={REPO} target="_blank" rel="noreferrer">GitHub</a>
            <a href={`${REPO}/issues`} target="_blank" rel="noreferrer">Report a problem</a>
          </nav>
        </div>
        <p>© {new Date().getFullYear()} cistem.dev · Made by Murtuza Ranapur</p>
      </footer>
      <Toast />
    </div>
  );
}
