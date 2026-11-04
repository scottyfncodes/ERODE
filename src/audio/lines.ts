// The voiced lines. Each one plays when its exact subtitle shows on the radio strip, so the text
// here must match what the game shows (tests/voice.test.ts holds the missions to it). The files
// are made by GITCRAFT AudioCraft (Kokoro-82M), one voice per character, from
// art/audio/voice.json; radio lines are band-limited and crushed like a handset when they are made.

export type Cast = 'dispatch' | 'avalanche' | 'skipatrol' | 'roadcrew' | 'greta' | 'nils' | 'driver';

export interface VoiceLine {
  id: string;
  cast: Cast;
  /** heard over the radio (narrow band, squelch) rather than in person */
  radio: boolean;
  text: string;
}

const R = true;
const IN = false;

export const VOICE_LINES: readonly VoiceLine[] = [
  // valley dispatch
  { id: 'dispatch_morning', cast: 'dispatch', radio: R, text: 'Morning, Kessel Patrol. Forty centimetres up high overnight. There is a call on your mission table.' },
  { id: 'dispatch_koda', cast: 'dispatch', radio: R, text: 'Koda is already at the door.' },
  { id: 'dispatch_grounded', cast: 'dispatch', radio: R, text: 'Nobody flies in this. Wait for it to pass.' },
  { id: 'dispatch_data', cast: 'dispatch', radio: R, text: 'Data coming through. Nice work.' },
  { id: 'dispatch_road_closed', cast: 'dispatch', radio: R, text: 'Pass road closed below Kessel Bowl.' },
  { id: 'dispatch_road_open', cast: 'dispatch', radio: R, text: 'Pass road open again.' },
  { id: 'dispatch_rounds_alert', cast: 'dispatch', radio: R, text: 'The Grauhorn weather station stopped transmitting overnight.' },
  { id: 'dispatch_rounds_done', cast: 'dispatch', radio: R, text: 'Station is transmitting again. Thanks. Fresh numbers: forty centimetres overnight up there.' },
  { id: 'dispatch_drift_alert', cast: 'dispatch', radio: R, text: 'A van has slid into a drift on the Tannberg road.' },
  { id: 'dispatch_drift_done', cast: 'dispatch', radio: R, text: 'Van is back on the road. The driver waved. Mostly.' },
  // the avalanche service
  { id: 'avy_recon_alert', cast: 'avalanche', radio: R, text: 'Heavy loading reported above the pass road. Recon flight requested.' },
  { id: 'avy_recon_done', cast: 'avalanche', radio: R, text: 'Report filed. Slopes A and C are loaded. We bring them down tomorrow, or today if you are up for it.' },
  { id: 'avy_release_alert', cast: 'avalanche', radio: R, text: 'Slopes A and C above the pass road are ready to go. Bring them down on our terms.' },
  { id: 'avy_release_done', cast: 'avalanche', radio: R, text: 'Clean release, the berm held, the road is open. That is how it is done.' },
  { id: 'avy_clear', cast: 'avalanche', radio: R, text: 'Charges set. Get clear of the slope: up on the ridge is safe. Then fire.' },
  { id: 'avy_fire', cast: 'avalanche', radio: R, text: 'Fire in the hole.' },
  { id: 'avy_secondary', cast: 'avalanche', radio: R, text: 'Secondary release on the next slope over. That is fine, let it run.' },
  { id: 'avy_down_road', cast: 'avalanche', radio: R, text: 'It is down. A little over the road, but the barrier did its job.' },
  { id: 'avy_down_berm', cast: 'avalanche', radio: R, text: 'It is down. The berm caught the lot. Beautiful.' },
  // Tannberg ski patrol and the road crew
  { id: 'ski_alert', cast: 'skipatrol', radio: R, text: 'A skier missed the last chair. Last seen at the top station heading for the trees.' },
  { id: 'ski_clinic', cast: 'skipatrol', radio: R, text: 'The clinic in Hollin is expecting him.' },
  { id: 'ski_done', cast: 'skipatrol', radio: R, text: 'Nils is warm, splinted and eating soup. He says Koda is the best dog he has ever met.' },
  { id: 'road_tree_alert', cast: 'roadcrew', radio: R, text: 'A spruce has come down across the pass road below Kessel Bowl.' },
  { id: 'road_tree_done', cast: 'roadcrew', radio: R, text: 'Pass road clear. Thanks for the quick work.' },
  // Greta Holm, the Kettle: on the radio when she calls, in person when you get there
  { id: 'greta_wood_alert', cast: 'greta', radio: R, text: "Kessel Patrol, it's Greta at the Kettle. I'm down to my last logs and there's snow on the way." },
  { id: 'greta_wood_thanks', cast: 'greta', radio: IN, text: "Oh, bless you both. Mind the step, it's icy." },
  { id: 'greta_wood_done', cast: 'greta', radio: IN, text: "That's the stove sorted for a week. Come in for a hot chocolate any time." },
  { id: 'greta_pepper_alert', cast: 'greta', radio: R, text: "It's Greta again. Pepper went out before the snow and she hasn't come home." },
  { id: 'greta_pepper_thanks', cast: 'greta', radio: IN, text: 'Pepper! You silly thing. Come here, you are frozen.' },
  { id: 'greta_pepper_done', cast: 'greta', radio: IN, text: 'Pepper is on the windowsill pretending none of this happened.' },
  // the villagers you help
  { id: 'nils_aid', cast: 'nils', radio: IN, text: 'I heard the dog first. I thought I was dreaming.' },
  { id: 'nils_carry', cast: 'nils', radio: IN, text: "Thank you. I really didn't fancy another night out here." },
  { id: 'driver_thanks', cast: 'driver', radio: IN, text: "That's it, she's free! Thank you. I'd still be sat here at midnight." },
];

const BY_TEXT = new Map(VOICE_LINES.map((l) => [l.text, l]));

/** The voiced line for a subtitle, if there is one. */
export function voiceFor(text: string): VoiceLine | undefined {
  return BY_TEXT.get(text);
}
