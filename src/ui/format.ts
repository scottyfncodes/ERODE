/** Human size for a stone of radius r (m): its diameter in m / cm / mm. */
export function sizeLabel(r: number): string {
  const d = r * 2;
  if (d >= 1) return `${d.toFixed(1)} m`;
  if (d >= 0.01) return `${(d * 100).toFixed(d >= 0.1 ? 0 : 1)} cm`;
  return `${(d * 1000).toFixed(1)} mm`;
}
