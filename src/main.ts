import { AudioEngine } from './audio/audio';
import { Game } from './game/game';
import { browserStore, loadProfile, newProfile } from './progress/profile';
import { exposeSnapshot } from './game/snapshot';
import { loadKit } from './render/kitView';
import { loadPatrolModels } from './render/patrolModels';
import { TitleScreen } from './ui/title';
import './ui/style.css';

const loading = document.getElementById('loading')!;
const fill = loading.querySelector('.loading-fill') as HTMLElement;
const label = loading.querySelector('.loading-text') as HTMLElement;

function progress(f: number, text: string) {
  fill.style.width = `${Math.round(f * 100)}%`;
  label.textContent = text;
}

function fail(title: string, detail: string, retry = true) {
  // the title card may already be up: the message replaces it
  document.querySelector('.title-screen')?.remove();
  document.body.classList.remove('titled');
  loading.classList.remove('gone');
  loading.style.display = '';
  loading.innerHTML = `<div class="error-box"><div class="wordmark sm">ROCKSLIDE</div><h2>${title}</h2><p>${detail}</p>${
    retry ? '<button class="btn red" type="button" onclick="location.reload()">Try again</button>' : ''
  }</div>`;
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/** Hand the main thread back to the browser for a moment (input, the title's animation, a paint). */
const pause = () => new Promise<void>((r) => setTimeout(r, 0));

async function boot() {
  if (!webglAvailable()) {
    fail('WebGL is unavailable', 'ROCKSLIDE needs a browser with WebGL. Try a recent Safari, Chrome or Firefox.', false);
    return;
  }
  progress(0.05, 'Opening the station');
  await nextFrame();
  if (document.fonts?.ready) await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
  // The title card goes up straight away and the valley is built behind it. A tap on Start before the
  // valley is ready is kept (the sound starts in that tap, as iOS wants) and play begins when it is up.
  const ui = document.getElementById('ui')!;
  const audio = new AudioEngine();
  const title = new TitleScreen(ui, loadProfile(browserStore()) ?? newProfile(), import.meta.env.BASE_URL);
  let queued: boolean | null = null;
  title.onGo = (fresh) => {
    audio.unlock();
    queued = fresh;
    title.wait(fresh);
  };
  document.body.classList.add('titled');
  progress(0.08, 'Hauling up the rocks');
  // the Kessel kit: GLBs from GITCRAFT's MeshCraft (art/3d). The game still runs if one is missing.
  // ...and the patrol's sled, helicopter and spruce (art/3d/scripts/patrol_models.py). Any that fail to
  // load leave their code-built version in place.
  const [kit, models] = await Promise.all([
    loadKit(`${import.meta.env.BASE_URL}models/`, (f) => progress(0.08 + f * 0.06, 'Hauling up the rocks')),
    loadPatrolModels(`${import.meta.env.BASE_URL}models/`),
  ]);
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const game = new Game(canvas, ui, audio);
  await game.build(progress, kit, models, pause);
  progress(0.95, 'Waxing the skis');
  await pause();
  await game.warm();
  progress(1, 'Ready');
  game.start(title);
  (window as unknown as { patrol: unknown }).patrol = game.debug();
  exposeSnapshot(window, () => game.publicState());
  // two frames of the valley first, then the backdrop fades and the lodge shows behind the title
  await nextFrame();
  await nextFrame();
  loading.classList.add('gone');
  document.body.classList.add('booted');
  setTimeout(() => (loading.style.display = 'none'), 700);
  if (queued !== null) title.onGo(queued);
}

window.addEventListener('error', (e) => console.error('ROCKSLIDE error', e.message));
boot().catch((err) => {
  console.error(err);
  fail('The mountain would not load', 'Something went wrong while starting the game. Please reload the page.');
});
