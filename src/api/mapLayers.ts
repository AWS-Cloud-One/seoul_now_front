import { queryApi, QueryError, type MapGeometry, type MapQuery, type MapStatus } from './queries'
const cache = new Map<string, MapGeometry>()
const keyFor = (layer: string, query: MapQuery) => JSON.stringify([layer, query.bbox, query.level])
const matches = (data: MapQuery & { layer: string }, layer: string, query: MapQuery) =>
  data.layer === layer &&
  data.level === query.level &&
  JSON.stringify(data.bbox) === JSON.stringify(query.bbox)
export async function mapGeometry(
  layer: 'roads' | 'population' | 'parking',
  query: MapQuery,
  signal: AbortSignal,
  fresh = false,
) {
  const key = keyFor(layer, query)
  if (!fresh && cache.has(key)) return cache.get(key)!
  const data = await queryApi<MapGeometry>(
    `/map/layers/${layer}/geometry`,
    { bbox: query.bbox.join(','), level: query.level },
    signal,
  )
  if (
    !matches(data, layer, query) ||
    !data.geometry_version ||
    !Array.isArray(data.feature_collection.features)
  )
    throw new QueryError('지도 위치 응답 범위가 요청과 달라요.', 502)
  signal.throwIfAborted()
  cache.set(key, data)
  if (cache.size > 24) cache.delete(cache.keys().next().value!)
  return data
}
export async function mapLayer(
  layer: 'roads' | 'population',
  query: MapQuery,
  signal: AbortSignal,
) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const geometry = await mapGeometry(layer, query, signal, attempt > 0)
    try {
      const status = await queryApi<MapStatus>(
        `/map/layers/${layer}/status`,
        {
          bbox: query.bbox.join(','),
          level: query.level,
          geometry_version: geometry.geometry_version,
        },
        signal,
      )
      if (!matches(status, layer, query) || status.geometry_version !== geometry.geometry_version)
        throw new QueryError('지도 위치와 상태의 버전이 달라요.', 409, 'GEOMETRY_VERSION_MISMATCH')
      return { geometry, status }
    } catch (error) {
      if (!(
        error instanceof QueryError &&
        error.code === 'GEOMETRY_VERSION_MISMATCH' &&
        attempt === 0
      ))
        throw error
    }
  }
  throw new QueryError('지도 기준 자료가 변경됐어요. 다시 조회해 주세요.', 409)
}
export function clearMapCache() {
  cache.clear()
}
