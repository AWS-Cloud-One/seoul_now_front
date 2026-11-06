import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

export async function kakaoResponse(path: string, query: URLSearchParams, key: string) {
  const params = new URLSearchParams()
  let endpoint: string
  if (path === '/api/v1/kakao/places') {
    const text = query.get('query')?.trim()
    if (!text || text.length > 100)
      return { status: 422, body: { detail: '검색어를 1~100자로 입력해 주세요.' } }
    params.set('query', text)
    params.set('x', query.get('lon') || '126.978')
    params.set('y', query.get('lat') || '37.5665')
    params.set('size', '15')
    endpoint = 'https://dapi.kakao.com/v2/local/search/keyword.json'
  } else if (path === '/api/v1/kakao/directions') {
    const names = ['origin_lat', 'origin_lon', 'destination_lat', 'destination_lon']
    if (names.some((name) => !query.has(name) || !Number.isFinite(Number(query.get(name)))))
      return { status: 422, body: { detail: '출발지와 도착지 좌표를 확인해 주세요.' } }
    params.set('origin', query.get('origin_lon') + ',' + query.get('origin_lat'))
    params.set('destination', query.get('destination_lon') + ',' + query.get('destination_lat'))
    params.set('priority', 'RECOMMEND')
    params.set('summary', 'false')
    endpoint = 'https://apis-navi.kakaomobility.com/v1/directions'
  } else return null
  try {
    const response = await fetch(endpoint + '?' + params, {
      headers: { Authorization: 'KakaoAK ' + key },
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok)
      return {
        status: response.status === 429 ? 503 : 502,
        body: { detail: '카카오 API 키의 사용 권한과 호출 한도를 확인해 주세요.' },
      }
    const data = (await response.json()) as {
      routes?: {
        result_code: number
        summary: unknown
        sections?: { roads?: { vertexes?: number[] }[] }[]
      }[]
    }
    if (path.endsWith('/places')) return { status: 200, body: data }
    const route = data.routes?.[0]
    if (!route || route.result_code !== 0)
      return { status: 404, body: { detail: '자동차 경로를 찾지 못했어요.' } }
    const coordinates: number[][] = []
    for (const section of route.sections || [])
      for (const road of section.roads || []) {
        const vertices = road.vertexes || []
        for (let i = 0; i + 1 < vertices.length; i += 2)
          coordinates.push([vertices[i], vertices[i + 1]])
      }
    return { status: 200, body: { summary: route.summary, coordinates } }
  } catch {
    return {
      status: 502,
      body: { detail: '카카오 API에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.' },
    }
  }
}
/** Development only. The secret is read by Node and never included in the client bundle. */
export function kakaoDevProxy(key: string): Plugin {
  return {
    name: 'local-kakao-api',
    apply: 'serve',
    configureServer(server) {
      if (!key.trim()) return
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        const url = new URL(req.url || '/', 'http://localhost')
        if (!['/api/v1/kakao/places', '/api/v1/kakao/directions'].includes(url.pathname))
          return next()
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.end()
          return
        }
        const result = await kakaoResponse(url.pathname, url.searchParams, key)
        if (!result) return next()
        res.statusCode = result.status
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(JSON.stringify(result.body))
      })
    },
  }
}
