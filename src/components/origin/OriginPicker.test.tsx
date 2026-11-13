import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import OriginPicker from './OriginPicker'
import type { Location } from '../../api/contracts'
import { screenOrigin } from '../../api/screenTestApi'
import { FIXTURE_TIME } from '../../api/testFixtures'

afterEach(cleanup)
function Harness() {
  const [value, setValue] = useState<Location | null>(null)
  return <OriginPicker value={value} onChange={setValue} />
}
const reply = (data: unknown) =>
  Response.json({ request_id: crypto.randomUUID(), server_time: FIXTURE_TIME, error: null, data })
it('검색어를 모아서 호출하고 오래된 응답을 버리며 같은 검색어·limit·커서로 다음 페이지를 읽는다', async () => {
  let resolve!: (response: Response) => void
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    .mockResolvedValueOnce(reply({ items: [screenOrigin], next_cursor: 'next-page' }))
    .mockResolvedValueOnce(
      reply({ items: [{ ...screenOrigin, label: '다음 장소' }], next_cursor: null }),
    )
  vi.stubGlobal('fetch', fetcher)
  const user = userEvent.setup()
  render(<Harness />)
  await user.type(screen.getByRole('searchbox'), '강남')
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
  await user.clear(screen.getByRole('searchbox'))
  await user.type(screen.getByRole('searchbox'), '서울역')
  await screen.findByRole('button', { name: /서울역/ })
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
  await act(async () =>
    resolve(reply({ items: [{ ...screenOrigin, label: '오래된 결과' }], next_cursor: null })),
  )
  expect(screen.queryByText('오래된 결과')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '검색 결과 더 보기' }))
  await screen.findByRole('button', { name: /다음 장소/ })
  const url = new URL(fetcher.mock.calls[2][0], 'http://localhost')
  expect(Object.fromEntries(url.searchParams)).toEqual({
    query: '서울역',
    limit: '5',
    cursor: 'next-page',
  })
  expect(fetcher).toHaveBeenCalledTimes(3)
})
it('지원 밖 장소를 선택할 수 없고 위치 권한 거부 후에도 검색할 수 있다', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    reply({
      items: [{ ...screenOrigin, label: '부산', supported: false, region: 'other' }],
      next_cursor: null,
    }),
  )
  vi.stubGlobal('fetch', fetcher)
  vi.stubGlobal('navigator', {
    geolocation: {
      getCurrentPosition: (_ok: unknown, fail: (error: { code: number }) => void) =>
        fail({ code: 1 }),
    },
  })
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: '현재 위치' }))
  expect(screen.getByText(/위치 권한이 거부/)).toBeInTheDocument()
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '부산' } })
  expect(await screen.findByRole('button', { name: /부산.*지원 지역 밖/ })).toBeDisabled()
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it('현재 좌표를 L02로 확인한 뒤 선택하고 이동 중 다른 검색을 하면 늦은 위치 콜백을 무시한다', async () => {
  let success!: PositionCallback
  const fetcher = vi
    .fn()
    .mockResolvedValue(reply({ location: { ...screenOrigin, label: '확인된 현재 위치' } }))
  vi.stubGlobal('fetch', fetcher)
  vi.stubGlobal('navigator', {
    geolocation: {
      getCurrentPosition: (ok: PositionCallback) => {
        success = ok
      },
    },
  })
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: '현재 위치' }))
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '다른 곳' } })
  await act(async () =>
    success({ coords: { latitude: 37.55, longitude: 126.97 } } as GeolocationPosition),
  )
  expect(fetcher).not.toHaveBeenCalled()
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: '현재 위치' }))
  await act(async () =>
    success({ coords: { latitude: 37.55, longitude: 126.97 } } as GeolocationPosition),
  )
  expect(await screen.findByText('확인된 현재 위치')).toBeInTheDocument()
  const url = new URL(fetcher.mock.calls[0][0], 'http://localhost')
  expect(url.pathname).toBe('/api/v1/locations/resolve')
  expect(Object.fromEntries(url.searchParams)).toEqual({ latitude: '37.55', longitude: '126.97' })
})
it('검색 제한 대기 중에는 자동 재호출하지 않고 대기 후 명시적으로 재시도한다', async () => {
  vi.useFakeTimers()
  try {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          {
            request_id: crypto.randomUUID(),
            server_time: FIXTURE_TIME,
            data: null,
            error: {
              code: 'RATE_LIMITED',
              message: '검색 요청 제한',
              retryable: true,
              retry_after_seconds: 2,
              details: [],
            },
          },
          { status: 429 },
        ),
      )
      .mockResolvedValueOnce(reply({ items: [screenOrigin], next_cursor: null }))
    vi.stubGlobal('fetch', fetcher)
    render(<Harness />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '서울역' } })
    await act(() => vi.advanceTimersByTimeAsync(400))
    expect(screen.getByRole('button', { name: '출발지 검색 다시 시도' })).toBeDisabled()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '강남역' } })
    await act(() => vi.advanceTimersByTimeAsync(400))
    expect(screen.getByRole('button', { name: '출발지 검색 다시 시도' })).toBeDisabled()
    await act(() => vi.advanceTimersByTimeAsync(2200))
    expect(fetcher).toHaveBeenCalledTimes(1)
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: '출발지 검색 다시 시도' })),
    )
    expect(fetcher).toHaveBeenCalledTimes(2)
  } finally {
    vi.useRealTimers()
  }
})
