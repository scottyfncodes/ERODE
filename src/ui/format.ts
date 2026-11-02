/** Human size for a stone of radius r (m): its diameter in m / cm / mm. */
export function sizeLabel(r: number): string {
  const d = r * 2;
  if (d >= 1) return `${d.toFixed(1)} m`;
  if (d >= 0.01) return `${(d * 100).toFixed(d >= 0.1 ? 0 : 1)} cm`;
  return `${(d * 1000).toFixed(1)} mm`;
}

/** Kilograms with thousands separators. */
export function kg(n: number): string {
  return `${Math.round(n).toLocaleString('en-US')} kg`;
}

/** A retained fraction as a percentage; one decimal where it matters. */
export function pct(f: number, digits = 1): string {
  return `${(Math.max(0, f) * 100).toFixed(digits)}%`;
}

export function seconds(s: number): string {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return m ? `${m}:${r.toFixed(1).padStart(4, '0')}` : `${r.toFixed(1)}s`;
}
