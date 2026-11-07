export const ROUTE_TRAFFIC = [
  { state: 4, label: '원활', color: '#00c73c' },
  { state: 3, label: '서행', color: '#ffc400' },
  { state: 2, label: '지체', color: '#ff8a00' },
  { state: 1, label: '정체', color: '#e62525' },
  { state: 6, label: '통행 불가', color: '#9d2639' },
  { state: 0, label: '정보 없음', color: '#8a98a9' },
]
export const routeTrafficColor = (state: number) =>
  ROUTE_TRAFFIC.find((item) => item.state === state)?.color || '#8a98a9'
export type RouteSegment = { path: [number, number][]; state: number }
