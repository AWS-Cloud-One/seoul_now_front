import { afterEach, expect, it, vi } from 'vitest'
import { screenOrigin } from '../api/screenTestApi'
import { FIXTURE_TIME } from '../api/testFixtures'
import { getOrigin, locateOrigin, setOrigin } from './origin'

const reply = (location: unknown) =>
  Response.json({
    request_id: crypto.randomUUID(),
    server_time: FIXTURE_TIME,
    error: null,
    data: { location },
  })
function position(ok = true) {
  vi.stubGlobal('navigator', {
    ...navigator,
    geolocation: {
      getCurrentPosition: (success: PositionCallback, failure: PositionErrorCallback) =>
        ok
          ? success({ coords: { latitude: 37.4, longitude: 127.1 } } as GeolocationPosition)
          : failure({ code: 1 } as GeolocationPositionError),
    },
  })
}
const settled = () => vi.waitFor(() => expect(getOrigin().status).not.toBe('locating'))
afterEach(() => {
  vi.unstubAllGlobals()
})

it('서울 안의 현재 위치는 바로 출발지로 쓰고 새로고침해도 유지한다', async () => {
  position()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => reply({ ...screenOrigin, region: 'seoul' })),
  )
  locateOrigin()
  await settled()
  expect(getOrigin()).toMatchObject({ status: 'ready', source: 'current' })
  expect(JSON.parse(sessionStorage.getItem('sn-origin-v1')!).location.label).toBe('서울역')
})

it('서울 밖이면 출발지를 묻고, 지원 지역(경기)의 현재 위치는 한 번에 고를 수 있게 남긴다', async () => {
  position()
  const gyeonggi = { ...screenOrigin, label: '판교역', region: 'gyeonggi', address: '경기 성남시' }
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => reply(gyeonggi)),
  )
  locateOrigin()
  await settled()
  expect(getOrigin()).toMatchObject({ status: 'needs-input', location: null })
  expect(getOrigin().message).toContain('서울이 아니에요')
  expect(getOrigin().detected?.label).toBe('판교역')
})

it('지원 지역 밖이거나 위치 권한이 없으면 고를 후보 없이 출발지 입력을 요청한다', async () => {
  position()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => reply({ ...screenOrigin, region: 'other', supported: false })),
  )
  locateOrigin()
  await settled()
  expect(getOrigin()).toMatchObject({ status: 'needs-input', detected: null })
  position(false)
  locateOrigin()
  await settled()
  expect(getOrigin().message).toContain('위치 권한')
})

it('직접 고른 출발지는 이전 값을 바꾸고 검색 출처로 기록한다', () => {
  setOrigin({ ...screenOrigin, label: '강남역' })
  expect(getOrigin()).toMatchObject({ status: 'ready', source: 'search' })
  expect(getOrigin().location?.label).toBe('강남역')
})
