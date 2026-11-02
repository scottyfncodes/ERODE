import { loadRapier } from './sim/rapier';
import { SUMMIT_TO_SEA } from './levels/summitToSea';
import { Game } from './game/game';
import { BRAND, wordmark } from './ui/brand';

const loading = document.getElementById('loading')!;
const fill = loading.querySelector('.loading-fill') as HTMLElement;
const label = loading.querySelector('.loading-text') as HTMLElement;

function progress(f: number, text: string) {
  fill.style.width = `${Math.round(f * 100)}%`;
  label.textContent = text;
}

function fail(title: string, detail: string, retry = true) {
  loading.classList.remove('gone');
  loading.innerHTML = `<div class="error-box">${wordmark('sm')}<h2>${title}</h2><p>${detail}</p>${
    retry ? '<button class="btn-go" type="button" onclick="location.reload()">Try again</button>' : ''
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
    fail('WebGL is unavailable', `${BRAND.name} needs a browser with WebGL. Try a recent Safari, Chrome or Firefox.`, false);
    return;
  }
  progress(0.05, 'Loosening the boulder…');
  const R = await loadRapier();
  await nextFrame();
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const game = new Game(canvas, document.getElementById('ui')!, document.getElementById('markers')!, R, SUMMIT_TO_SEA, progress);
  await nextFrame();
  progress(1, 'Ready');
  game.start();
  // debug handle for the scripts in /scripts
  (window as unknown as { rockslide: unknown }).rockslide = game.debug();
  setTimeout(() => loading.classList.add('gone'), 250);
}

window.addEventListener('error', (e) => console.error(`${BRAND.name} error`, e.message));
boot().catch((err) => {
  console.error(err);
  fail('The mountain would not load', 'Something went wrong while starting the game. Please reload the page.');
});
