import { CHARGE_SPOTS, pad } from '../world/places';
import { SPOTS } from '../world/station';
import type { Contact } from './recon';

/**
 * Every job on the mountain as data. A mission is a short list of steps; the runner checks each
 * step against the world and moves on. Five families share one shape.
 */

export type Family = 'rescue' | 'avalanche' | 'recon' | 'response' | 'community';

export const FAMILY_LABEL: Record<Family, string> = {
  rescue: 'Search & rescue',
  avalanche: 'Avalanche control',
  recon: 'Aerial recon',
  response: 'Mountain response',
  community: 'Community',
};

export interface Target {
  x: number;
  z: number;
  label: string;
}

export type Vehicle = 'foot' | 'sled' | 'heli' | 'skis';

export type Step =
  | { kind: 'goto'; at: Target; radius: number; text: string; by?: Vehicle[] }
  | { kind: 'interact'; id: string; at: Target | 'dog'; radius?: number; text: string; action: string; hold: number; prop?: string; onFoot?: boolean }
  | { kind: 'mount'; vehicle: Vehicle; text: string }
  | { kind: 'scan'; contacts: Contact[]; text: string }
  | { kind: 'land'; at: Target; text: string }
  | { kind: 'charges'; spots: string[]; text: string }
  | { kind: 'fire'; text: string }
  | { kind: 'watch'; text: string }
  | { kind: 'track'; trail: { x: number; z: number }[]; at: Target; text: string; start: Target }
  | { kind: 'carry'; text: string };

export interface MissionDef {
  id: string;
  family: Family;
  title: string;
  /** who asked */
  from: string;
  /** the briefing, two or three plain sentences */
  brief: string;
  /** the one-line alert on the radio */
  alert: string;
  reward: { funds: number; rep: number };
  /** missions that must be done first */
  requires: string[];
  steps: Step[];
  /** a world event: comes and goes, can recur */
  dynamic?: boolean;
  /** the person or animal involved (for the scene) */
  subject?: { kind: 'skier' | 'cat' | 'driver'; x: number; z: number; name: string };
  /** where on the map to draw it */
  where: Target;
  /** sets the bowl to controlled when done */
  controls?: boolean;
  /** a ribbon of radio lines on completion */
  done: string;
}

const P = (id: string, label?: string): Target => {
  const p = pad(id);
  return { x: p.x, z: p.z, label: label ?? p.name };
};

export const HQ_T: Target = { x: 0, z: 250, label: 'Patrol Station' };
const PAD_T: Target = { x: SPOTS.heli.x, z: SPOTS.heli.z, label: 'Helipad' };
const GATE: Target = { x: -150, z: -40, label: 'Pass barrier' };
const LODGE_T: Target = { x: 330, z: 461, label: 'The Kettle, Hollin' };
const CLINIC_T: Target = { x: 380, z: 506, label: 'Hollin clinic' };

/** The slopes of Kessel Bowl, as SKYTRACE recon contacts. */
export const BOWL_CONTACTS: Contact[] = CHARGE_SPOTS.map((c) => ({
  x: c.x,
  z: c.z,
  label: c.label.toUpperCase(),
  kind: 'slope',
  target: c.weak,
  clear: c.weak ? `${c.label}: wind slab on a buried weak layer. Loaded. Marked.` : `${c.label}: well bonded, scoured by the wind. Stable.`,
}));

/** Nils's last tracks from the top station into the trees. */
const NILS = { x: 640, z: -220 };
const NILS_TRAIL = [
  { x: 608, z: -326 },
  { x: 624, z: -324 },
  { x: 641, z: -315 },
  { x: 655, z: -300 },
  { x: 661, z: -281 },
  { x: 654, z: -263 },
  { x: 646, z: -246 },
  { x: 641, z: -230 },
  { x: 640, z: -225 },
];

const PEPPER = { x: -342, z: 386 };
const PEPPER_TRAIL = [
  { x: -300, z: 452 },
  { x: -318, z: 432 },
  { x: -330, z: 414 },
  { x: -338, z: 398 },
  { x: -342, z: 390 },
];

export const MISSIONS: MissionDef[] = [
  {
    id: 'rounds',
    family: 'response',
    title: 'Morning Rounds',
    from: 'Valley dispatch',
    alert: 'The Grauhorn weather station stopped transmitting overnight.',
    brief: 'The weather station up on Grauhorn Pass went quiet overnight. Take the sled up the pass road and get it talking again. Koda will want to come.',
    reward: { funds: 150, rep: 120 },
    requires: [],
    where: P('station'),
    steps: [
      { kind: 'interact', id: 'pet', at: 'dog', text: 'Say good morning to Koda', action: 'Pet Koda', hold: 0 },
      { kind: 'mount', vehicle: 'sled', text: 'Get on the sled in the garage' },
      { kind: 'goto', at: P('station'), radius: 26, text: 'Ride up the pass road to the weather station' },
      { kind: 'interact', id: 'anemometer', at: { x: -646, z: -296, label: 'Weather station' }, text: 'Clear the ice off the station and restart it', action: 'Repair', hold: 3, onFoot: true },
      { kind: 'goto', at: HQ_T, radius: 34, text: 'Head home to the station' },
    ],
    done: 'Station is transmitting again. Thanks. Fresh numbers: forty centimetres overnight up there.',
  },
  {
    id: 'survey',
    family: 'recon',
    title: 'Eyes on Kessel Bowl',
    from: 'Avalanche service',
    alert: 'Heavy loading reported above the pass road. Recon flight requested.',
    brief: 'Forty centimetres of new snow and a west wind overnight. Fly over Kessel Bowl, above the pass road, and find out which of its four slopes are loaded. Nose on each slope, low and close, and the scanner reads it.',
    reward: { funds: 220, rep: 160 },
    requires: ['rounds'],
    where: { x: -120, z: -400, label: 'Kessel Bowl' },
    steps: [
      { kind: 'mount', vehicle: 'heli', text: 'Start the helicopter on the pad' },
      { kind: 'goto', at: { x: -120, z: -330, label: 'Kessel Bowl' }, radius: 170, text: 'Fly to Kessel Bowl', by: ['heli'] },
      { kind: 'scan', contacts: BOWL_CONTACTS, text: 'Scan the four slopes: nose on each one, close and low' },
      { kind: 'land', at: PAD_T, text: 'Fly home and land on the pad' },
    ],
    done: 'Report filed. Slopes A and C are loaded. We bring them down tomorrow, or today if you are up for it.',
  },
  {
    id: 'release',
    family: 'avalanche',
    title: 'Controlled Release',
    from: 'Avalanche service',
    alert: 'Slopes A and C above the pass road are ready to go. Bring them down on our terms.',
    brief: 'Slopes A and C are wind slab on a weak layer. Close the pass road, climb to Kessel Ridge, set a charge on each loaded slope, get clear and fire. The berm in the runout is there to catch it.',
    reward: { funds: 340, rep: 260 },
    requires: ['survey'],
    where: { x: -120, z: -400, label: 'Kessel Bowl' },
    controls: true,
    steps: [
      { kind: 'interact', id: 'locker', at: { x: SPOTS.locker.x - 1.2, z: SPOTS.locker.z, label: 'Explosives locker' }, text: 'Take the charges from the locker in the garage', action: 'Take charges', hold: 1, onFoot: true },
      { kind: 'interact', id: 'gate-close', at: GATE, text: 'Close the pass road at the barrier', action: 'Close road', hold: 1.2, prop: 'gate' },
      { kind: 'goto', at: P('ridge', 'Kessel Ridge'), radius: 24, text: 'Take the ridge track up to Kessel Ridge' },
      { kind: 'charges', spots: ['A', 'C'], text: 'Set a charge on each loaded slope' },
      { kind: 'fire', text: 'Get clear of the slope, then fire the charges' },
      { kind: 'watch', text: 'Watch it run' },
      { kind: 'interact', id: 'gate-open', at: GATE, text: 'Reopen the pass road', action: 'Open road', hold: 1.2, prop: 'gate' },
    ],
    done: 'Clean release, the berm held, the road is open. That is how it is done.',
  },
  {
    id: 'skier',
    family: 'rescue',
    title: 'Lost on the Tannberg',
    from: 'Tannberg ski patrol',
    alert: 'A skier missed the last chair. Last seen at the top station heading for the trees.',
    brief: 'Nils Brandt, 34, skied off the back of the Tannberg top station into the trees and has not come down. His phone is dead. His friends found one of his gloves by the lift. Get Koda on his scent.',
    reward: { funds: 380, rep: 300 },
    requires: ['survey'],
    where: P('lifttop'),
    subject: { kind: 'skier', x: NILS.x, z: NILS.z, name: 'Nils' },
    steps: [
      { kind: 'goto', at: P('lifttop'), radius: 32, text: 'Get to the Tannberg top station: up the run on the sled, or fly' },
      { kind: 'track', start: { x: 606, z: -327, label: "Nils's glove" }, trail: NILS_TRAIL, at: { x: NILS.x, z: NILS.z, label: 'Nils' }, text: 'Let Koda take the scent from the glove, then follow' },
      { kind: 'interact', id: 'aid-nils', at: { x: NILS.x, z: NILS.z, label: 'Nils' }, text: 'Warm Nils up and splint his ankle', action: 'First aid', hold: 3, onFoot: true },
      { kind: 'carry', text: 'Bring the sled over and help Nils on' },
      { kind: 'goto', at: CLINIC_T, radius: 16, text: 'Take Nils down to the clinic in Hollin', by: ['sled'] },
      { kind: 'interact', id: 'handover-nils', at: CLINIC_T, radius: 6, text: 'Hand Nils over at the clinic', action: 'Hand over', hold: 0.6, onFoot: true },
    ],
    done: 'Nils is warm, splinted and eating soup. He says Koda is the best dog he has ever met.',
  },
  {
    id: 'supplies',
    family: 'community',
    title: 'Firewood for the Kettle',
    from: 'Greta Holm, the Kettle',
    alert: "Kessel Patrol, it's Greta at the Kettle. I'm down to my last logs and there's snow on the way.",
    brief: "Greta runs the Kettle, the lodge in Hollin. Her firewood and lamp oil came up on the truck and it's sitting in our yard. Snow's coming tonight: get it down to her.",
    reward: { funds: 160, rep: 110 },
    requires: ['rounds'],
    where: LODGE_T,
    steps: [
      { kind: 'interact', id: 'crate', at: { x: SPOTS.crate.x, z: SPOTS.crate.z, label: 'Supply crate' }, text: 'Load the supply crate onto the sled rack', action: 'Load crate', hold: 1, onFoot: true },
      { kind: 'mount', vehicle: 'sled', text: 'Get on the sled' },
      { kind: 'goto', at: LODGE_T, radius: 22, text: 'Ride down to the Kettle in Hollin', by: ['sled'] },
      { kind: 'interact', id: 'unload', at: { x: 336, z: 466, label: 'Greta' }, text: 'Unload the crate for Greta', action: 'Unload', hold: 1, onFoot: true },
    ],
    done: "That's the stove sorted for a week. Come in for a hot chocolate any time.",
  },
  {
    id: 'pepper',
    family: 'community',
    title: "Where's Pepper?",
    from: 'Greta Holm, the Kettle',
    alert: "It's Greta again. Pepper went out before the snow and she hasn't come home.",
    brief: "Pepper, Greta's grey cat, slipped out this morning and hasn't come back. She likes the old boathouse by Mirror Lake. Koda knows cats.",
    reward: { funds: 140, rep: 120 },
    requires: ['supplies'],
    where: { x: -300, z: 452, label: 'Mirror Lake' },
    subject: { kind: 'cat', x: PEPPER.x, z: PEPPER.z, name: 'Pepper' },
    steps: [
      { kind: 'goto', at: { x: -300, z: 455, label: 'Mirror Lake' }, radius: 30, text: 'Go to Mirror Lake' },
      { kind: 'track', start: { x: -296, z: 456, label: 'Paw prints' }, trail: PEPPER_TRAIL, at: { x: PEPPER.x, z: PEPPER.z, label: 'Pepper' }, text: 'Show Koda the paw prints, then follow' },
      { kind: 'interact', id: 'pepper', at: { x: PEPPER.x, z: PEPPER.z, label: 'Pepper' }, text: 'Coax Pepper down and pick her up', action: 'Pick up', hold: 1.6, onFoot: true },
      { kind: 'goto', at: LODGE_T, radius: 22, text: 'Bring Pepper home to the Kettle' },
      { kind: 'interact', id: 'pepper-home', at: { x: 336, z: 466, label: 'Greta' }, text: 'Give Pepper back to Greta', action: 'Hand over', hold: 0.6, onFoot: true },
    ],
    done: 'Pepper is on the windowsill pretending none of this happened.',
  },
  {
    id: 'tree',
    family: 'response',
    title: 'Tree Down on the Pass',
    from: 'Road crew',
    alert: 'A spruce has come down across the pass road below Kessel Bowl.',
    brief: 'The snow load brought a big spruce down across the pass road. Nobody hurt, but nothing gets up or down until it is cleared.',
    reward: { funds: 90, rep: 70 },
    requires: ['rounds'],
    dynamic: true,
    where: { x: -112, z: 30, label: 'Pass road' },
    steps: [
      { kind: 'goto', at: { x: -112, z: 30, label: 'Fallen tree' }, radius: 18, text: 'Get to the fallen tree on the pass road' },
      { kind: 'interact', id: 'saw', at: { x: -112, z: 30, label: 'Fallen tree' }, radius: 6, text: 'Cut the trunk and drag it clear', action: 'Saw', hold: 3.5, onFoot: true, prop: 'fallen' },
    ],
    done: 'Pass road clear. Thanks for the quick work.',
  },
  {
    id: 'drift',
    family: 'response',
    title: 'Stuck in the Drift',
    from: 'Valley dispatch',
    alert: 'A van has slid into a drift on the Tannberg road.',
    brief: 'A delivery van went off the Tannberg road into a drift. The driver is fine and cross. Dig it out and get it back on the road.',
    reward: { funds: 90, rep: 70 },
    requires: ['rounds'],
    dynamic: true,
    where: { x: 262, z: 232, label: 'Tannberg road' },
    subject: { kind: 'driver', x: 266, z: 238, name: 'Driver' },
    steps: [
      { kind: 'goto', at: { x: 262, z: 232, label: 'Stuck van' }, radius: 18, text: 'Find the van on the Tannberg road' },
      { kind: 'interact', id: 'dig', at: { x: 262, z: 232, label: 'Stuck van' }, radius: 6, text: 'Dig out the wheels', action: 'Dig out', hold: 3, onFoot: true, prop: 'van' },
    ],
    done: 'Van is back on the road. The driver waved. Mostly.',
  },
];

export const mission = (id: string): MissionDef => MISSIONS.find((m) => m.id === id)!;
