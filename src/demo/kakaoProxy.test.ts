import { describe, expect, it, vi } from 'vitest'
import { kakaoResponse } from '../../dev/kakaoProxy'

describe('Kakao server adapter', () => {
  it('rejects missing search and route parameters before making upstream calls', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    expect(
      (await kakaoResponse('/api/v1/kakao/places', new URLSearchParams(), 'secret'))?.status,
    ).toBe(422)
    expect(
      (
        await kakaoResponse(
          '/api/v1/kakao/directions',
          new URLSearchParams('origin_lat=no'),
          'secret',
        )
      )?.status,
    ).toBe(422)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('keeps authorization on the upstream request and converts road vertices to route coordinates', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        routes: [
          {
            result_code: 0,
            summary: { distance: 700, duration: 120 },
            sections: [{ roads: [{ traffic_state: 2, vertexes: [126.9, 37.5, 126.91, 37.51] }] }],
          },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetcher)
    const result = await kakaoResponse(
      '/api/v1/kakao/directions',
      new URLSearchParams(
        'origin_lat=37.5&origin_lon=126.9&destination_lat=37.51&destination_lon=126.91',
      ),
      'test-secret',
    )
    expect(result).toEqual({
      status: 200,
      body: {
        summary: { distance: 700, duration: 120 },
        segments: [
          {
            coordinates: [
              [126.9, 37.5],
              [126.91, 37.51],
            ],
            traffic_state: 2,
          },
        ],
        coordinates: [
          [126.9, 37.5],
          [126.91, 37.51],
        ],
      },
    })
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('KakaoAK test-secret')
    expect(JSON.stringify(result)).not.toContain('test-secret')
  })
  it('returns a sanitized error when upstream fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('secret provider error')))
    const result = await kakaoResponse(
      '/api/v1/kakao/places',
      new URLSearchParams('query=홍대'),
      'secret',
    )
    expect(result?.status).toBe(502)
    expect(JSON.stringify(result)).not.toContain('secret')
  })
})
