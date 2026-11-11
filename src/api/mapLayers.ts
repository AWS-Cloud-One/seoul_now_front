import {
  queryApi,
  queryApiResponse,
  QueryError,
  type MapGeometry,
  type MapQuery,
  type MapStatus,
} from './queries'
import { bufferedViewport } from './mapViewport'
import {
  clearGeometryCache,
  findGeometry,
  geometryGeneration,
  geometryKey,
  invalidateGeometry,
  shareGeometry,
  storeGeometry,
} from './mapGeometryCache'
const matches = (data: MapQuery & { layer: string }, layer: string, query: MapQuery) =>
  data.layer === layer &&
  data.level === query.level &&
  JSON.stringify(data.bbox) === JSON.stringify(query.bbox)
export async function mapGeometry(
  layer: 'roads' | 'population' | 'parking',
  query: MapQuery,
  signal: AbortSignal,
  options: { refresh?: 'revalidate' | 'origin' } = {},
) {
  signal.throwIfAborted()
  const cached = findGeometry(layer, query)
  if (!options.refresh && cached?.data) return cached.data
  const requested = cached?.query ?? (layer === 'population' ? query : bufferedViewport(query))
  const force = options.refresh === 'origin'
  const fetchBounds = (bounds: MapQuery) =>
    shareGeometry(
      `${geometryKey(layer, bounds)}:${force ? 'origin' : 'normal'}`,
      signal,
      async (sharedSignal) => {
        if (force) invalidateGeometry(layer)
        const generation = geometryGeneration(layer)
        sharedSignal.throwIfAborted()
        const response = await queryApiResponse<MapGeometry>(
          `/map/layers/${layer}/geometry`,
          {
            bbox: bounds.bbox.join(','),
            level: bounds.level,
            ...(force ? { cache_refresh: crypto.randomUUID() } : {}),
          },
          sharedSignal,
        )
        const data = response.data
        if (
          !matches(data, layer, bounds) ||
          !data.geometry_version ||
          !Array.isArray(data.feature_collection.features)
        )
          throw new QueryError('지도 위치 응답 범위가 요청과 달라요.', 502)
        sharedSignal.throwIfAborted()
        storeGeometry(data, response, generation)
        return data
      },
    )
  try {
    return await fetchBounds(requested)
  } catch (error) {
    if (
      !(error instanceof QueryError && error.code === 'MAP_RANGE_TOO_LARGE') ||
      geometryKey(layer, requested) === geometryKey(layer, query)
    )
      throw error
    // Each consumer retries its own visible range after a shared buffered request fails.
    return fetchBounds(query)
  }
}
export async function mapLayer(
  layer: 'roads' | 'population',
  query: MapQuery,
  signal: AbortSignal,
) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const geometry = await mapGeometry(
      layer,
      query,
      signal,
      attempt > 0 ? { refresh: 'origin' } : {},
    )
    try {
      const status = await queryApi<MapStatus>(
        `/map/layers/${layer}/status`,
        {
          bbox: geometry.bbox.join(','),
          level: geometry.level,
          geometry_version: geometry.geometry_version,
        },
        signal,
      )
      if (
        !matches(status, layer, geometry) ||
        status.geometry_version !== geometry.geometry_version
      )
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
  clearGeometryCache()
}
