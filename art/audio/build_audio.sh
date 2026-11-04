#!/usr/bin/env bash
# Finish the AudioCraft renders into what the game ships in public/audio/:
#   voice/   one file per line (src/audio/lines.ts); radio lines band-limited and crushed like a
#            handset, in-person lines clean; all -18 LUFS, mono 22.05 kHz
#   music/   the Kessel theme as three sample-aligned layers (patrol, mission, emergency)
#   sting/   mission complete, rank up, avalanche warning
# Each file as Ogg Vorbis (.ogg) and AAC (.m4a, for Safari before 17 / older iOS).
#
# Inputs are the AudioCraft outputs in gitcraft-out/audio (see art/audio/README.md for the calls).
set -euo pipefail
cd "$(dirname "$0")/../.."
SRC=gitcraft-out/audio
OUT=public/audio
mkdir -p "$OUT/voice" "$OUT/music" "$OUT/sting" "$OUT/sfx"
# `build_audio.sh sfx` rebuilds only the impact sets (the rest need their own AudioCraft renders)
ONLY=${1:-all}

enc() { # in.wav out-stem ogg-quality aac-bitrate [extra ffmpeg args...]
  local in=$1 stem=$2 q=$3 br=$4; shift 4
  ffmpeg -v error -y -i "$in" "$@" -c:a libvorbis -q:a "$q" "$stem.ogg"
  ffmpeg -v error -y -i "$in" "$@" -c:a aac -b:a "$br" -movflags +faststart "$stem.m4a"
}

# --- impacts: boots on snow, heavy things landing in it -----------------------------------------
# AudioCraft `sfx` footstep and thud takes, short and mono; the game filters each hit itself
# (snow muffles: the low-pass depends on how hard the boot lands and what it lands in).
sfx() {
  local i=1
  for f in "$SRC"/snowstep/snowstep_0[1-6].wav; do
    enc "$f" "$OUT/sfx/step_$i" 3 48k -af "highpass=f=70,afade=t=out:st=0.1:d=0.05" -ar 22050 -ac 1
    i=$((i + 1))
  done
  i=1
  for f in "$SRC"/snowthud/snowthud_0[1-4].wav; do
    enc "$f" "$OUT/sfx/thud_$i" 3 48k -af "highpass=f=35,afade=t=out:st=0.22:d=0.1" -ar 22050 -ac 1
    i=$((i + 1))
  done
}
# --- ambience: the high-altitude wind bed (AudioCraft `ambience` wind, a seamless 24 s loop) ------
amb() {
  mkdir -p "$OUT/amb"
  enc "$SRC/alpine_wind/alpine_wind.wav" "$OUT/amb/wind" 2 64k -af "highpass=f=60,lowpass=f=7000,loudnorm=I=-24:TP=-3" -ar 22050 -ac 2
}
if [[ $ONLY == amb ]]; then
  amb
  du -ch "$OUT/amb" | tail -1
  exit 0
fi
if [[ $ONLY == sfx ]]; then
  sfx
  du -ch "$OUT/sfx" | tail -1
  exit 0
fi
sfx
amb

# --- voice -------------------------------------------------------------------------------------
RADIO_IDS=$(python3 -c "import json;print(' '.join(json.load(open('art/audio/voice.json'))['radio']))")
# a handheld: 350 Hz-3 kHz, a little grit, squashed hard, then the loudness target
RADIO='highpass=f=350,highpass=f=350,lowpass=f=3000,lowpass=f=3000,acrusher=bits=10:mode=log:mix=0.35:aa=1,acompressor=threshold=-24dB:ratio=6:attack=3:release=60:makeup=6,loudnorm=I=-18:TP=-2:LRA=7'
ROOM='highpass=f=90,acompressor=threshold=-22dB:ratio=3:attack=5:release=120,loudnorm=I=-18:TP=-2:LRA=9'
for f in "$SRC"/voice/*.wav; do
  id=$(basename "$f" .wav)
  af=$ROOM
  [[ " $RADIO_IDS " == *" $id "* ]] && af=$RADIO
  enc "$f" "$OUT/voice/$id" 1 32k -af "silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse,$af" -ar 22050 -ac 1
done

# --- the theme: three layers, sample-aligned, every file exactly one loop --------------------
T=$SRC/theme/stems/kessel-theme
LOOP=1008000 # samples at 44.1 kHz (8 bars at 84 bpm), from kessel-theme.layers.json
mix() { # out-stem stem...
  local out=$1; shift
  local args=() n=0
  for s in "$@"; do args+=(-i "$T"_"$s".wav); n=$((n + 1)); done
  ffmpeg -v error -y "${args[@]}" -filter_complex "amix=inputs=$n:normalize=0,atrim=end_sample=$LOOP" "$SRC/$out.wav"
  enc "$SRC/$out.wav" "$OUT/music/$out" 2 64k -ac 1
}
mix theme_patrol pad arp
mix theme_mission bass lead
mix theme_emergency drums

# --- stingers: one shot, with a tail ----------------------------------------------------------
enc "$SRC/sting-complete/sting-complete.wav" "$OUT/sting/complete" 2 64k -af "afade=t=out:st=1.6:d=0.9,loudnorm=I=-16:TP=-1.5" -ac 1
enc "$SRC/sting-rankup/sting-rankup.wav" "$OUT/sting/rankup" 2 64k -af "afade=t=out:st=4.0:d=1.3,loudnorm=I=-16:TP=-1.5" -ac 1
enc "$SRC/sting-avalanche/sting-avalanche.wav" "$OUT/sting/avalanche" 2 64k -af "afade=t=out:st=2.4:d=0.8,loudnorm=I=-17:TP=-1.5" -ac 1

du -ch "$OUT" | tail -1
