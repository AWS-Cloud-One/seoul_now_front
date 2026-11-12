/** Estimate only: straight-line distance with a 1.3 detour factor at roughly 4 km/h. */
export function estimatedWalkMinutes(meters: number): number | null {
  if (!Number.isFinite(meters) || meters < 0) return null
  return Math.max(1, Math.round((meters * 1.3) / 67))
}
