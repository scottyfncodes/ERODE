import RAPIER from '@dimforge/rapier3d-deterministic-compat';

let ready: Promise<typeof RAPIER> | null = null;

/** Load the physics engine once (WASM is inlined in the bundle). */
export function loadRapier(): Promise<typeof RAPIER> {
  ready ??= RAPIER.init().then(() => RAPIER);
  return ready;
}
