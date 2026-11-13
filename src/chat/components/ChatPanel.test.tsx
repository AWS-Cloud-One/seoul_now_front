import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockChatClient } from '../api/mockClient'
import { ChatController } from '../state/controller'
import { memoryStorage } from '../state/storage'
import ChatPanel from './ChatPanel'
import { getMapOverlay } from '../../hooks/useRoute'
import { takeDirectionsTarget } from '../../state/directionsTarget'
import { removeRecommendation, selectRecommendation } from '../state/recommendations'

const controllers: ChatController[] = []
afterEach(() => controllers.splice(0).forEach((c) => c.dispose()))

function renderPanel(client = createMockChatClient({ stepsPerRun: 2 })) {
  const controller = new ChatController({
    client,
    storage: memoryStorage(),
    intervals: { visible: 5, hidden: 5, max: 20, first: 1 },
  })
  controllers.push(controller)
  const user = userEvent.setup()
  const go = vi.fn()
  const view = render(<ChatPanel go={go} controller={controller} />)
  return { controller, client, user, go, view }
}

async function say(user: ReturnType<typeof userEvent.setup>, text: string) {
  const input = await screen.findByRole('textbox', { name: 'AI에게 보낼 메시지' })
  await waitFor(() => expect(input).toBeEnabled())
  await user.clear(input)
  await user.type(input, text)
  await user.click(screen.getByRole('button', { name: '보내기' }))
}
const idle = (controller: ChatController) => waitFor(() => expect(controller.busy).toBe(false))

describe('ChatPanel', () => {
  it('상단 새 대화는 조건·입력·이전 추천 선택을 비우고 저장한 묶음은 보존한다', async () => {
    const { user, controller, go, view } = renderPanel()
    await say(user, '성수 카페 추천해줘 3명')
    await idle(controller)
    const result = controller.getState().turns[0].run!.response!.recommendation!
    await user.click(screen.getByRole('button', { name: '추천 묶음 저장' }))
    await user.click(screen.getAllByRole('button', { name: '지도에서 보기' })[0])
    act(() => selectRecommendation(result.result_id))
    await user.type(screen.getByRole('textbox', { name: 'AI에게 보낼 메시지' }), '이전 초안')
    const old = controller.getState().snapshot!.conversation_id
    await user.click(screen.getByRole('button', { name: '새 대화' }))
    await waitFor(() => expect(controller.getState().snapshot!.conversation_id).not.toBe(old))
    expect(screen.getByRole('textbox', { name: 'AI에게 보낼 메시지' })).toHaveValue('')
    expect(screen.queryByRole('region', { name: '1회차 추천' })).not.toBeInTheDocument()
    expect(getMapOverlay().recommendation).toBeNull()
    view.rerender(<ChatPanel view="recommend" go={go} controller={controller} />)
    expect(screen.getByRole('textbox', { name: '찾을 지역' })).toBeInTheDocument()
    expect(screen.queryByText(/저장한 추천 묶음이에요/)).not.toBeInTheDocument()
    expect(
      JSON.parse(localStorage.getItem('sn-saved-recommendations-v2')!).some(
        (item: { recommendation: { result_id: string } }) =>
          item.recommendation.result_id === result.result_id,
      ),
    ).toBe(true)
    act(() => removeRecommendation(result.result_id))
  })

  it('대화 결과를 목록·지도·길찾기·저장에 같은 장소로 연결한다', async () => {
    const { user, controller, go, view } = renderPanel()
    await say(user, '성수 카페 추천해줘')
    await idle(controller)
    const result = controller.getState().turns[0].run!.response!.recommendation!
    const place = result.cards[0].place.value!
    view.rerender(<ChatPanel view="recommend" go={go} controller={controller} />)
    await user.click(screen.getAllByRole('button', { name: '지도에서 보기' })[0])
    expect(getMapOverlay().recommendation).toMatchObject({
      id: place.place_id,
      name: place.name,
      rank: 1,
    })
    await user.click(screen.getAllByRole('button', { name: '여기로 길찾기' })[0])
    expect(takeDirectionsTarget()).toMatchObject({
      id: place.place_id,
      name: place.name,
      lat: place.coordinates.latitude,
    })
    await user.click(screen.getByRole('button', { name: '추천 묶음 저장' }))
    expect(
      JSON.parse(localStorage.getItem('sn-saved-recommendations-v2')!)[0].recommendation.result_id,
    ).toBe(result.result_id)
    view.rerender(<ChatPanel view="saved" go={go} controller={controller} />)
    await user.click(screen.getByRole('button', { name: /성수 일대 추천 · 3곳/ }))
    expect(go).toHaveBeenCalledWith('recommend')
    view.rerender(<ChatPanel view="recommend" go={go} controller={controller} />)
    expect(screen.getByText(/저장한 추천 묶음이에요/)).toBeInTheDocument()
    expect(screen.getByText(place.name)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '주차 묻기' })).not.toBeInTheDocument()
    act(() => {
      removeRecommendation(result.result_id)
    })
  })

  it('지역 조건 입력은 출발지 없이 채팅 요청을 보내고 대화로 이어진다', async () => {
    const { user, controller, client, go, view } = renderPanel()
    await waitFor(() => expect(controller.canSend).toBe(true))
    view.rerender(<ChatPanel view="recommend" go={go} controller={controller} />)
    expect(screen.queryByText('출발지를 정해야 추천할 수 있어요.')).not.toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: '찾을 지역' }), '성수')
    await user.click(screen.getByRole('button', { name: '카페' }))
    const submit = vi.spyOn(client, 'submitRun')
    await user.click(screen.getByRole('button', { name: '이 조건으로 추천받기' }))
    expect(go).toHaveBeenCalledWith('chat')
    await idle(controller)
    expect(submit.mock.calls[0][2].input).toMatchObject({
      type: 'message',
      text: '성수 안에서, 출발지와 이동시간 제한 없이 카페 추천해줘',
    })
    expect(screen.getByRole('region', { name: '1회차 추천' })).toBeInTheDocument()
  })

  it('UI-01 자유 입력으로 지역 카드를 받고, 가짜 이동시간 없이 표시 순서임을 알린다', async () => {
    const { user, controller } = renderPanel()
    await say(user, '성수 카페 추천해줘')
    await idle(controller)
    const result = await screen.findByRole('region', { name: '1회차 추천' })
    expect(
      within(result)
        .getAllByRole('listitem')
        .filter((li) => li.className === 'sn-chat-card'),
    ).toHaveLength(3)
    expect(within(result).getByText(/번호는 순위가 아닌 표시 순서예요/)).toBeInTheDocument()
    expect(
      within(result).queryByText('출발지 없이 찾아 이동시간은 계산하지 않았어요'),
    ).not.toBeInTheDocument()
    expect(within(result).queryByText(/0분/)).not.toBeInTheDocument()
    // Registered parking: a count, an explicit "none in radius", and "could not check" stay apart.
    expect(within(result).getByText(/등록 주차장 4곳/)).toBeInTheDocument()
    expect(within(result).getByText('반경 500m 안에 등록 주차장이 없어요')).toBeInTheDocument()
    expect(within(result).getByText('제공처 자료를 받지 못했어요')).toBeInTheDocument()
    // Current conditions in the header come from the conversation snapshot.
    await waitFor(() => expect(screen.getByText(/성수 일대 · 카페/)).toBeInTheDocument())
    expect(screen.getByText(/반영됨 · 방문 목적/)).toBeInTheDocument()
  })

  it('UI-02 질문에 단답으로 답하면 질문 ID와 함께 그대로 보낸다', async () => {
    const { user, controller, client } = renderPanel()
    await say(user, '뭐 하지')
    await idle(controller)
    expect(await screen.findByText('답변 · 무엇을 하고 싶으세요?')).toBeInTheDocument()
    const submit = vi.spyOn(client, 'submitRun')
    await say(user, '셋이요')
    const body = submit.mock.calls[0][2]
    expect(body.input).toMatchObject({ type: 'message', text: '셋이요' })
    expect(body.input).toHaveProperty('reply_to_clarification_id')
    await idle(controller)
    expect(await screen.findByText(/반영됨 · .*인원/)).toBeInTheDocument()
  })

  it('답변 칩을 닫으면 질문 ID 없이 새 질문으로 보낸다', async () => {
    const { user, controller, client } = renderPanel()
    await say(user, '뭐 하지')
    await idle(controller)
    await user.click(
      await screen.findByRole('button', { name: '질문에 대한 답변으로 보내지 않기' }),
    )
    const submit = vi.spyOn(client, 'submitRun')
    await say(user, '예약 되는 곳 있어?')
    expect(submit.mock.calls[0][2].input).not.toHaveProperty('reply_to_clarification_id')
  })

  it('UI-03 이번만 적용한 조건은 카드에 표시하고 현재 조건은 바꾸지 않는다', async () => {
    const { user, controller } = renderPanel()
    await say(user, '성수 카페 추천해줘')
    await idle(controller)
    await say(user, '이번만 20분 안으로 카페 추천')
    await idle(controller)
    const second = await screen.findByRole('region', { name: '2회차 추천' })
    expect(within(second).getByText('이번 추천에만 적용')).toBeInTheDocument()
    expect(within(second).getByText(/이동시간 20분 이내/)).toBeInTheDocument()
    expect(controller.getState().snapshot?.conditions.max_travel_seconds).toBeNull()
  })

  it('UI-04 과거 카드의 후속 질문은 그 회차와 장소를 대상으로 보낸다', async () => {
    const { user, controller, client } = renderPanel()
    await say(user, '성수 카페 추천해줘')
    await idle(controller)
    await say(user, '강남 카페 추천해줘')
    await idle(controller)
    const first = screen.getByRole('region', { name: '1회차 추천' })
    const group = within(first).getByRole('group', { name: /1회차 추천 · 2번 서울숲 브루어스/ })
    await user.click(within(group).getByRole('button', { name: '주차 묻기' }))
    expect(screen.getByText('대상 · 1회차 추천 · 2번 서울숲 브루어스')).toBeInTheDocument()
    const submit = vi.spyOn(client, 'submitRun')
    await user.click(screen.getByRole('button', { name: '보내기' }))
    const firstResult = controller.getState().turns[0].run!.response!.recommendation!.result_id
    expect(submit.mock.calls[0][2].viewed_context).toEqual({
      result_id: firstResult,
      place_ref: `result:${firstResult}:2`,
    })
    await idle(controller)
    expect(await screen.findByText('주변 주차장')).toBeInTheDocument()
    expect(
      screen.queryByText('실시간 빈자리가 아닌 등록된 주차장 목록이에요.'),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '성수동 공영주차장 지도에서 보기' }))
    expect(getMapOverlay().lookup).toMatchObject({
      name: '성수동 공영주차장',
      kind: 'parking',
      lat: 37.5442,
      lng: 127.0561,
    })
  })

  it('UI-05 한 경로 자료가 없으면 우열 없이 비교 불가와 확인된 값만 보여준다', async () => {
    const { user, controller } = renderPanel()
    await say(user, '성수 카페 추천해줘')
    await idle(controller)
    await say(user, '1번이랑 2번 비교해줘')
    await idle(controller)
    const compare = await screen.findByRole('region', { name: '이동시간 비교' })
    expect(within(compare).getByText('자료 없음')).toBeInTheDocument()
    expect(within(compare).getByText(/약 25분/)).toBeInTheDocument()
    expect(within(compare).queryByText('가장 빠름')).not.toBeInTheDocument()
    expect(within(compare).getByText(/우열을 정하지 않았어요/)).toBeInTheDocument()
  })

  it('UI-07 추천 후 이어진 조회가 실패하면 추천은 유지하고 허용된 조회만 재시도한다', async () => {
    const { user, controller } = renderPanel()
    await say(user, '성수 카페 추천해줘 주차도 실패')
    await idle(controller)
    expect(await screen.findByRole('region', { name: '1회차 추천' })).toBeInTheDocument()
    expect(
      screen.getByText(/추천은 완료됐고, 이어서 요청한 조회는 완료하지 못했어요/),
    ).toBeInTheDocument()
    expect(screen.getByText('일부 완료')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '조회 다시 시도' }))
    await idle(controller)
    expect(await screen.findByText('주변 주차장을 확인했어요.')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '1회차 추천' })).toBeInTheDocument()
  })

  it('UI-08 처리 중 중단하면 서버의 중단 결과와 미반영을 표시한다', async () => {
    const { user, controller } = renderPanel(createMockChatClient({ stepsPerRun: 50 }))
    await say(user, '성수 카페 추천해줘')
    const stop = await screen.findByRole('button', { name: '응답 중지' })
    expect(screen.queryByRole('button', { name: '보내기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '중단' })).not.toBeInTheDocument()
    await user.click(stop)
    await idle(controller)
    expect(await screen.findByText('요청을 중단했어요')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '1회차 추천' })).not.toBeInTheDocument()
  })

  it('UI-09 응답을 못 받으면 같은 요청으로 확인하는 버튼만 주고 새 요청을 만들지 않는다', async () => {
    const client = createMockChatClient({ stepsPerRun: 2 })
    const { user, controller } = renderPanel(client)
    client.dropNext()
    await say(user, '성수 카페 추천해줘')
    expect(await screen.findByRole('alert')).toHaveTextContent('전송 결과를 확인하지 못했어요')
    expect(screen.queryByRole('button', { name: '보내기' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '접수 여부 확인 필요' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '같은 요청으로 확인' }))
    await idle(controller)
    expect(client.runs.size).toBe(1)
    expect(await screen.findByRole('region', { name: '1회차 추천' })).toBeInTheDocument()
  })

  it('UI-11 지원 안 함과 해석 실패는 서로 다른 안내로 보여준다', async () => {
    const { user, controller } = renderPanel()
    await say(user, '예약 되는 곳 있어?')
    await idle(controller)
    expect(await screen.findByText('지원하지 않는 요청이에요')).toBeInTheDocument()
    await say(user, '오류 나는 요청')
    await idle(controller)
    expect(await screen.findByText('요청을 해석하지 못했어요')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '요청 다시 해석' })).toBeInTheDocument()
  })

  it('서버 선택지(출발지 후보)를 누르면 action으로 바로 실행하고 질문을 답변 완료로 바꾼다', async () => {
    const { user, controller, client } = renderPanel()
    await say(user, '성수 카페 추천해줘')
    await idle(controller)
    await say(user, '여기까지 얼마나 걸려?')
    await idle(controller)
    const options = await screen.findByRole('list', { name: '어디에서 출발하나요? 선택지' })
    expect(within(options).getByText('서울 용산구 한강대로 지하 392')).toBeInTheDocument()
    const submit = vi.spyOn(client, 'submitRun')
    await user.click(within(options).getByRole('button', { name: /서울역 버스환승센터/ }))
    expect(submit.mock.calls[0][2].input).toMatchObject({ type: 'action' })
    expect(submit.mock.calls[0][2]).not.toHaveProperty('viewed_context')
    await idle(controller)
    expect(await screen.findByText(/서울역 버스환승센터에서.*분/)).toBeInTheDocument()
    expect(screen.getByText('선택지')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('답변 완료')).toBeInTheDocument())
    expect(
      screen.queryByRole('list', { name: '어디에서 출발하나요? 선택지' }),
    ).not.toBeInTheDocument()
  })

  it('질문이 둘이면 최신 질문만 자동 답변 대상이고, 다른 질문은 버튼으로 골라 답한다', async () => {
    const { user, controller, client } = renderPanel()
    await say(user, '뭐 하지')
    await idle(controller)
    await user.click(
      await screen.findByRole('button', { name: '질문에 대한 답변으로 보내지 않기' }),
    )
    await say(user, '성수 카페 얼마나 걸려?')
    await idle(controller)
    await waitFor(() => expect(controller.getState().snapshot?.questions).toHaveLength(2))
    expect(screen.getByText('답변 · 어디에서 출발하나요?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '이 질문에 답하기' }))
    expect(screen.getByText('답변 · 무엇을 하고 싶으세요?')).toBeInTheDocument()
    const submit = vi.spyOn(client, 'submitRun')
    await say(user, '전시요')
    const purposes = controller
      .getState()
      .snapshot!.questions!.find((q) => q.required_field === 'purposes')!
    expect(submit.mock.calls[0][2].input).toMatchObject({
      reply_to_clarification_id: purposes.clarification_id,
    })
  })

  it('구조화 질문이 없는 이전(P4) 질문은 텍스트로만 보여주고 실행 버튼을 만들지 않는다', async () => {
    const { user, controller } = renderPanel()
    await say(user, '옛 질문 보여줘')
    await idle(controller)
    const legacy = await screen.findByRole('list', { name: '당시 출발지 후보' })
    expect(within(legacy).getByText(/서울역 · 서울 중구 한강대로 405/)).toBeInTheDocument()
    expect(within(legacy).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText(/이전 형식의 질문이에요/)).toBeInTheDocument()
  })

  it('새로고침 뒤에는 서버 이력으로 사용자 입력·답변·카드를 다시 보여준다', async () => {
    const client = createMockChatClient({ stepsPerRun: 2 })
    const storage = memoryStorage()
    const intervals = { visible: 5, hidden: 5, max: 20, first: 1 }
    const first = new ChatController({ client, storage, intervals })
    controllers.push(first)
    first.start()
    await waitFor(() => expect(first.getState().boot).toBe('ready'))
    await first.send('성수 카페 추천해줘')
    await waitFor(() => expect(first.busy).toBe(false))
    first.dispose()
    const second = new ChatController({ client, storage, intervals })
    controllers.push(second)
    render(<ChatPanel go={vi.fn()} controller={second} />)
    expect(await screen.findByText('성수 카페 추천해줘')).toBeInTheDocument()
    expect(await screen.findByRole('region', { name: '1회차 추천' })).toBeInTheDocument()
  })

  it('UI-12 만료되면 입력·버튼을 막고 새 대화로 다시 시작한다', async () => {
    let now = Date.now()
    const client = createMockChatClient({ stepsPerRun: 2, now: () => now })
    const controller = new ChatController({
      client,
      storage: memoryStorage(),
      now: () => now,
      intervals: { visible: 5, hidden: 5, max: 20, first: 1 },
    })
    controllers.push(controller)
    const user = userEvent.setup()
    render(<ChatPanel go={vi.fn()} controller={controller} />)
    await say(user, '성수 카페 추천해줘')
    await idle(controller)
    now += 25 * 3600_000
    await act(async () => {
      await controller.send('또 추천')
    })
    expect(await screen.findByText('대화가 만료됐어요')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'AI에게 보낼 메시지' })).toBeDisabled()
    for (const button of screen.getAllByRole('button', { name: '주차 묻기' }))
      expect(button).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '새 대화 시작' }))
    await waitFor(() => expect(controller.getState().boot).toBe('ready'))
    expect(screen.queryByRole('region', { name: '1회차 추천' })).not.toBeInTheDocument()
  })
})
