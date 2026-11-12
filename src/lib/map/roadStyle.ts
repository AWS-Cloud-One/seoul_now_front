export const ROAD_SPEED_COLORS = [
  { color: '#d9544e', label: '20 미만' },
  { color: '#c58e24', label: '20 이상 40 미만' },
  { color: '#208973', label: '40 이상' },
  { color: '#8999aa', label: '미확인' },
] as const

export function roadSpeedColor(speed: number | null) {
  const index = speed === null ? 3 : speed < 20 ? 0 : speed < 40 ? 1 : 2
  return ROAD_SPEED_COLORS[index].color
}
