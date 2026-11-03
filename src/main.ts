import { Game } from './game/game';
import { loadKit } from './render/kitView';
import { loadPatrolModels } from './render/patrolModels';
import './ui/style.css';

const loading = document.getElementById('loading')!;
const fill = loading.querySelector('.loading-fill') as HTMLElement;
const label = loading.querySelector('.loading-text') as HTMLElement;

function progress(f: number, text: string) {
  fill.style.width = `${Math.round(f * 100)}%`;
  label.textContent = text;
}

function fail(title: string, detail: string, retry = true) {
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

async function boot() {
  if (!webglAvailable()) {
    fail('WebGL is unavailable', 'ROCKSLIDE needs a browser with WebGL. Try a recent Safari, Chrome or Firefox.', false);
    return;
  }
  progress(0.05, 'Opening the station');
  await nextFrame();
  if (document.fonts?.ready) await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
  progress(0.08, 'Hauling up the rocks');
  // the Kessel kit: GLBs from GITCRAFT's MeshCraft (art/3d). The game still runs if one is missing.
  // ...and the patrol's sled, helicopter and spruce (art/3d/scripts/patrol_models.py). Any that fail to
  // load leave their code-built version in place.
  const [kit, models] = await Promise.all([
    loadKit(`${import.meta.env.BASE_URL}models/`, (f) => progress(0.08 + f * 0.06, 'Hauling up the rocks')),
    loadPatrolModels(`${import.meta.env.BASE_URL}models/`),
  ]);
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const game = new Game(canvas, document.getElementById('ui')!, progress, kit, models);
  await nextFrame();
  progress(1, 'Ready');
  game.start();
  (window as unknown as { patrol: unknown }).patrol = game.debug();
  // two frames of the valley first (shaders compile on the first), then the loading card fades
  // and the title rises in after it, so the two never show their emblems at once
  await nextFrame();
  await nextFrame();
  loading.classList.add('gone');
  document.body.classList.add('booted');
  setTimeout(() => (loading.style.display = 'none'), 700);
}

window.addEventListener('error', (e) => console.error('ROCKSLIDE error', e.message));
boot().catch((err) => {
  console.error(err);
  fail('The mountain would not load', 'Something went wrong while starting the game. Please reload the page.');
});
