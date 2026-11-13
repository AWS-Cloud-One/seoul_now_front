import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatError, type ChatClient } from '../api/client'
import { createMockChatClient } from '../api/mockClient'
import { ChatController } from './controller'
import { emptyStored, memoryStorage, type ChatStorage } from './storage'

const FAST = { visible: 5, hidden: 5, max: 20, first: 1 }
const controllers: ChatController[] = []

function setup({
  client = createMockChatClient({ stepsPerRun: 2 }),
  storage = memoryStorage(),
  now,
}: {
  client?: ReturnType<typeof createMockChatClient>
  storage?: ChatStorage
  now?: () => number
} = {}) {
  const controller = new ChatController({ client, storage, intervals: FAST, now })
  controllers.push(controller)
  return { controller, client, storage }
}
async function ready(controller: ChatController) {
  controller.start()
  await vi.waitFor(() => expect(controller.getState().boot).toBe('ready'))
}
async function settled(controller: ChatController) {
  await vi.waitFor(() => {
    expect(controller.busy).toBe(false)
  })
}

afterEach(() => {
  controllers.splice(0).forEach((c) => c.dispose())
})

describe('ChatController', () => {
  it('세션·대화를 만들고, 보낸 요청을 진행 단계부터 결과까지 하나의 메시지로 추적한다', async () => {
    const { controller, storage } = setup()
    await ready(controller)
    expect(storage.load().session?.token).toContain('.')
    expect(storage.load().conversation_id).toBe(controller.getState().snapshot?.conversation_id)

    expect(await controller.send('성수 카페 추천해줘')).toBe('accepted')
    await settled(controller)
    const { turns, snapshot } = controller.getState()
    expect(turns).toHaveLength(1)
    const [turn] = turns
    expect(turn.phase).toBe('finished')
    expect(turn.events.map((e) => e.type)).toContain('stage_started')
    expect(new Set(turn.events.map((e) => e.event_seq)).size).toBe(turn.events.length)
    expect(turn.run?.response?.recommendation?.cards).toHaveLength(3)
    // Conditions come from the re-read conversation, not from the answer text.
    await vi.waitFor(() => expect(controller.getState().snapshot?.condition_version).toBe(1))
    expect(snapshot).not.toBeNull()
    // Messages are not cached in the browser; only session/conversation/pending are stored.
    expect(Object.keys(storage.load()).sort()).toEqual(['conversation_id', 'pending', 'session'])
    expect(storage.load().pending).toBeNull()
  })

  it('응답을 못 받은 요청은 같은 request ID·본문으로만 다시 확인하고 중복 실행하지 않는다', async () => {
    const { controller, client, storage } = setup()
    await ready(controller)
    client.dropNext()
    expect(await controller.send('성수 카페 추천해줘')).toBe('unconfirmed')
    const [turn] = controller.getState().turns
    expect(turn.phase).toBe('unconfirmed')
    expect(storage.load().pending?.body.request_id).toBe(turn.key)

    const sent = JSON.stringify(turn.body)
    const submit = vi.spyOn(client, 'submitRun')
    controller.confirm(turn.key)
    await settled(controller)
    expect(submit).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(submit.mock.calls[0][2])).toBe(sent)
    const [confirmed] = controller.getState().turns
    expect(controller.getState().turns).toHaveLength(1)
    expect(confirmed.phase).toBe('finished')
    expect(confirmed.run?.identity.request_id).toBe(turn.key)
    expect(client.runs.size).toBe(1)
    expect(storage.load().pending).toBeNull()
  })

  it('새로고침하면 messages API로 서버 이력을 복원하고, 이미 저장된 미확인 요청은 다시 보내지 않는다', async () => {
    const client = createMockChatClient({ stepsPerRun: 2 })
    const storage = memoryStorage()
    const first = setup({ client, storage }).controller
    await ready(first)
    await first.send('성수 카페 추천해줘')
    await settled(first)
    client.dropNext()
    await first.send('셋이요')
    first.dispose()

    expect(storage.load().pending).not.toBeNull()

    const { controller } = setup({ client, storage })
    const submit = vi.spyOn(client, 'submitRun')
    await ready(controller)
    await settled(controller)
    const { turns } = controller.getState()
    expect(turns.map((t) => [t.source, t.text])).toEqual([
      ['history', '성수 카페 추천해줘'],
      ['history', '셋이요'],
    ])
    expect(turns.every((t) => t.phase === 'finished' && t.messageId)).toBe(true)
    // The server already had the "lost" request, so nothing was resent or duplicated.
    expect(submit).not.toHaveBeenCalled()
    expect(client.runs.size).toBe(2)
    expect(storage.load().pending).toBeNull()
  })

  it('다른 화면이 실행 중이면 409 RUN_ACTIVE로 보내지 않고 기존 실행을 붙인다', async () => {
    const { controller, client, storage } = setup({
      client: createMockChatClient({ stepsPerRun: 3 }),
    })
    await ready(controller)
    const snapshot = controller.getState().snapshot!
    await client.submitRun(storage.load().session!.token, snapshot.conversation_id, {
      schema_version: 2,
      request_id: crypto.randomUUID(),
      expected_condition_version: 0,
      expected_state_version: 0,
      input: { type: 'message', text: '강남 카페 추천' },
    })
    controller.setComposer({ text: '성수 카페 추천해줘' })
    expect(await controller.sendComposer(null)).toBe('rejected')
    // The refused text returns to the draft instead of being lost.
    expect(controller.getState().composer.text).toBe('성수 카페 추천해줘')
    await vi.waitFor(() =>
      expect(controller.getState().turns.some((t) => t.source === 'external')).toBe(true),
    )
    await settled(controller)
    const external = controller.getState().turns.find((t) => t.source === 'external')!
    expect(external.run?.response?.recommendation).toBeTruthy()
  })

  it('지난 질문 ID로 보내면 충돌로 안내하고 자동으로 버전을 바꿔 다시 보내지 않는다', async () => {
    const { controller, client } = setup()
    await ready(controller)
    await controller.send('뭐 하지')
    await settled(controller)
    const submit = vi.spyOn(client, 'submitRun')
    expect(
      await controller.send('셋이요', {
        replyTo: { clarificationId: 'stale-id', question: '무엇을 하고 싶으세요?' },
      }),
    ).toBe('rejected')
    expect(submit).toHaveBeenCalledTimes(1)
    const last = controller.getState().turns.at(-1)!
    expect(last.phase).toBe('rejected')
    expect(last.problem?.kind).toBe('conflict')
  })

  it('중단은 서버 cancel API를 한 번만 호출하고 서버가 돌려준 결과를 따른다', async () => {
    const { controller, client } = setup({ client: createMockChatClient({ stepsPerRun: 4 }) })
    await ready(controller)
    const cancel = vi.spyOn(client, 'cancelRun')
    await controller.send('성수 카페 추천해줘')
    const key = controller.getState().turns[0].key
    await Promise.all([controller.cancel(key), controller.cancel(key)])
    expect(cancel).toHaveBeenCalledTimes(1)
    await settled(controller)
    const response = controller.getState().turns[0].run?.response
    expect(response?.status).toBe('cancelled')
    expect(response?.recommendation).toBeFalsy()
  })

  it('재시도는 서버가 허용한 작업만 새 request ID와 원본 run ID로 보낸다', async () => {
    const { controller, client } = setup()
    await ready(controller)
    await controller.send('오류 나는 요청')
    await settled(controller)
    const [source] = controller.getState().turns
    expect(source.run?.retryable_tasks).toEqual(['interpretation'])
    expect(await controller.retry(source.key, 'lookup')).toBe('blocked')
    const submit = vi.spyOn(client, 'submitRun')
    expect(await controller.retry(source.key, 'interpretation')).toBe('accepted')
    const body = submit.mock.calls[0][2]
    expect(body.request_id).not.toBe(source.key)
    expect(body.input).toEqual({
      type: 'retry',
      source_run_id: source.run!.identity.run_id,
      task_ids: ['interpretation'],
    })
  })

  it('늦게 도착한 낮은 state_version의 대화 상태로 현재 조건을 되돌리지 않는다', async () => {
    const { controller, client } = setup()
    await ready(controller)
    await controller.send('성수 카페 추천해줘')
    await settled(controller)
    await vi.waitFor(() => expect(controller.getState().snapshot?.condition_version).toBe(1))
    const latest = controller.getState().snapshot!
    vi.spyOn(client, 'getConversation').mockResolvedValueOnce({
      ...latest,
      state_version: latest.state_version - 1,
      condition_version: 0,
    })
    await controller.refreshConversation()
    expect(controller.getState().snapshot?.condition_version).toBe(1)
  })

  it('저장된 세션이 거부되면 한 번만 새 세션으로 시작하고 안내한다', async () => {
    const storage = memoryStorage({
      ...emptyStored(),
      session: { token: 'bad.token', expires_at: new Date(Date.now() + 3600_000).toISOString() },
      conversation_id: crypto.randomUUID(),
    })
    const { controller, client } = setup({ storage })
    const create = vi.spyOn(client, 'createSession')
    await ready(controller)
    expect(create).toHaveBeenCalledTimes(1)
    expect(controller.getState().notice).toContain('세션')
  })

  it('대화가 만료되면 보내기를 막고 새 대화 시작으로 안내한다', async () => {
    let now = Date.now()
    const client = createMockChatClient({ stepsPerRun: 2, now: () => now })
    const { controller } = setup({ client, now: () => now })
    await ready(controller)
    now += 25 * 3600_000
    expect(await controller.send('성수 카페')).toBe('blocked')
    expect(controller.getState().boot).toBe('expired')
    controller.restart()
    await vi.waitFor(() => expect(controller.getState().boot).toBe('ready'))
  })

  it('새 대화는 이전 대화를 지우지 않고, 삭제는 서버에서 지운 뒤 새 대화를 연다', async () => {
    const { controller, client } = setup()
    await ready(controller)
    await controller.send('성수 카페 추천해줘 3명')
    await settled(controller)
    controller.setComposer({
      text: '이전 대화 초안',
      reply: { clarificationId: 'old', question: '이전 질문' },
    })
    const first = controller.getState().snapshot!.conversation_id
    await controller.newConversation()
    const second = controller.getState().snapshot!.conversation_id
    expect(second).not.toBe(first)
    expect(controller.getState()).toMatchObject({
      turns: [],
      refs: {},
      composer: { text: '', target: null, reply: null },
    })
    expect(controller.getState().snapshot).toMatchObject({
      conditions: { purposes: [], headcount: null, origin: null },
      search_area: null,
    })
    expect(client.conversations.get(first)?.deleted).toBeFalsy()
    await controller.deleteConversation()
    expect(client.conversations.get(second)?.deleted).toBe(true)
    expect(controller.getState().snapshot!.conversation_id).not.toBe(second)
  })

  it('이력은 최신 20회부터 받고, cursor를 그대로 보내 이전 페이지를 앞에 붙인다', async () => {
    const client = createMockChatClient({ stepsPerRun: 1 })
    const storage = memoryStorage()
    const first = setup({ client, storage }).controller
    await ready(first)
    const token = storage.load().session!.token
    const conversation = first.getState().snapshot!.conversation_id
    first.dispose()
    for (let i = 1; i <= 23; i += 1) {
      const { run } = await client.submitRun(token, conversation, {
        schema_version: 2,
        request_id: crypto.randomUUID(),
        expected_condition_version: 0,
        expected_state_version: 0,
        input: { type: 'message', text: `예약 ${i}` },
      })
      while ((await client.getRun(token, run.identity.run_id, 0)).run.status !== 'finished');
    }
    const { controller } = setup({ client, storage })
    await ready(controller)
    await vi.waitFor(() => expect(controller.getState().turns).toHaveLength(20))
    expect(controller.getState().turns[0].text).toBe('예약 4')
    expect(controller.getState().turns.at(-1)!.text).toBe('예약 23')
    const cursor = controller.getState().history.cursor
    expect(cursor).toBeTruthy()
    const messages = vi.spyOn(client, 'getMessages')
    await controller.loadOlder()
    expect(messages.mock.calls[0][2]).toEqual({ limit: 20, cursor })
    const texts = controller.getState().turns.map((t) => t.text)
    expect(texts.slice(0, 4)).toEqual(['예약 1', '예약 2', '예약 3', '예약 4'])
    expect(new Set(texts).size).toBe(23)
    expect(controller.getState().history.cursor).toBeNull()
  })

  it('서버 선택지는 action ID와 선택지의 버전만 보내고 viewed_context·label을 붙이지 않는다', async () => {
    const { controller, client } = setup()
    await ready(controller)
    await controller.send('뭐 하지')
    await settled(controller)
    await vi.waitFor(() => expect(controller.getState().snapshot?.questions).toHaveLength(1))
    const question = controller.getState().snapshot!.questions![0]
    expect(question).toMatchObject({ status: 'active', required_field: 'purposes' })
    const food = question.options.find((o) => o.label === '식사')!
    expect(food.status).toBe('available')
    const submit = vi.spyOn(client, 'submitRun')
    expect(await controller.choose(food, question)).toBe('accepted')
    expect(submit.mock.calls[0][2]).toEqual({
      schema_version: 2,
      request_id: expect.any(String),
      expected_condition_version: food.expected_condition_version,
      expected_state_version: food.expected_state_version,
      input: { type: 'action', action_id: food.action_id },
    })
    await settled(controller)
    const turn = controller.getState().turns.at(-1)!
    expect(turn).toMatchObject({ input: 'action', text: '식사' })
    expect(turn.run?.response?.recommendation?.effective_conditions.purposes[0].purpose).toBe(
      'food',
    )
    await vi.waitFor(() => expect(controller.getState().snapshot?.questions).toHaveLength(0))
  })

  it('이미 쓴 선택지를 다시 누르면 새 실행 없이 원래 결과로 이동한다', async () => {
    const { controller, client } = setup()
    await ready(controller)
    await controller.send('뭐 하지')
    await settled(controller)
    await vi.waitFor(() => expect(controller.getState().snapshot?.questions).toHaveLength(1))
    const question = controller.getState().snapshot!.questions![0]
    const cafe = question.options[0]
    await controller.choose(cafe, question)
    await settled(controller)
    const before = controller.getState().turns.length
    const runs = client.runs.size
    // The old screen still shows the button as available (another tab used it).
    expect(await controller.choose(cafe, question)).toBe('accepted')
    expect(client.runs.size).toBe(runs)
    expect(controller.getState().turns).toHaveLength(before)
    const original = controller.getState().turns.at(-1)!.run!.identity.run_id
    expect(controller.getState().focusRunId).toBe(original)
    expect(controller.getState().notice).toContain('이미 선택한')
  })

  it('ACTION_EXPIRED는 버튼만 만료로 보고 새 선택지를 받으며 자동으로 다시 누르지 않는다', async () => {
    let serverNow = Date.now()
    const client = createMockChatClient({ stepsPerRun: 2, now: () => serverNow })
    const { controller } = setup({ client })
    await ready(controller)
    await controller.send('뭐 하지')
    await settled(controller)
    await vi.waitFor(() => expect(controller.getState().snapshot?.questions).toHaveLength(1))
    const question = controller.getState().snapshot!.questions![0]
    const old = question.options[0]
    serverNow += 6 * 60_000
    const submit = vi.spyOn(client, 'submitRun')
    expect(await controller.choose(old, question)).toBe('rejected')
    expect(submit).toHaveBeenCalledTimes(1)
    const state = controller.getState()
    expect(state.boot).toBe('ready')
    expect(state.turns.some((t) => t.input === 'action')).toBe(false)
    expect(state.notice).toContain('새 선택지')
    const fresh = state.snapshot!.questions![0].options[0]
    expect(fresh.action_id).not.toBe(old.action_id)
    expect(fresh.status).toBe('available')
  })

  it('ACTION_STALE은 최신 질문을 다시 받고 새 버전으로 자동 재실행하지 않는다', async () => {
    const { controller, client } = setup()
    await ready(controller)
    await controller.send('뭐 하지')
    await settled(controller)
    await vi.waitFor(() => expect(controller.getState().snapshot?.questions).toHaveLength(1))
    const question = controller.getState().snapshot!.questions![0]
    const old = question.options[0]
    await controller.send('예약 되는 곳 있어?')
    await settled(controller)
    const submit = vi.spyOn(client, 'submitRun')
    expect(await controller.choose(old, question)).toBe('rejected')
    expect(submit).toHaveBeenCalledTimes(1)
    expect(controller.getState().notice).toContain('대화 상태가 바뀌어')
    const reissued = controller.getState().snapshot!.questions![0].options[0]
    expect(reissued.action_id).not.toBe(old.action_id)
    expect(reissued.expected_state_version).toBeGreaterThan(old.expected_state_version)
  })

  it('실패 작업 재시도에 action이 허용되면 action 작업만 명시적으로 재시도한다', async () => {
    const { controller, client } = setup()
    await ready(controller)
    await controller.send('뭐 하지')
    await settled(controller)
    const key = controller.getState().turns[0].key
    // Simulate the server allowing only the action task on an interrupted choice.
    const turn = controller.getState().turns[0]
    controller['patchTurn'](key, { run: { ...turn.run!, retryable_tasks: ['action'] } })
    const submit = vi.spyOn(client, 'submitRun')
    expect(await controller.retry(key, 'lookup')).toBe('blocked')
    await controller.retry(key, 'action')
    expect(submit.mock.calls[0][2].input).toEqual({
      type: 'retry',
      source_run_id: turn.run!.identity.run_id,
      task_ids: ['action'],
    })
  })

  it('HTTP 오류 본문 두 형식({error:{code}}, {detail})을 같은 분류로 바꾼다', async () => {
    const { createChatClient } = await import('../api/client')
    const respond = (status: number, body: unknown) =>
      vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
    const run = async (status: number, body: unknown) => {
      const client: ChatClient = createChatClient({ fetchImpl: respond(status, body) })
      return client.getConversation('a.b', 'id').catch((e: ChatError) => [e.kind, e.code])
    }
    expect(await run(409, { error: { code: 'RUN_ACTIVE' } })).toEqual(['run_active', 'RUN_ACTIVE'])
    expect(await run(409, { error: { code: 'VERSION_CONFLICT' } })).toEqual([
      'conflict',
      'VERSION_CONFLICT',
    ])
    expect(await run(401, { detail: 'UNAUTHORIZED' })).toEqual(['unauthorized', 'UNAUTHORIZED'])
    expect(await run(422, { detail: [{ msg: 'x' }] })).toEqual(['invalid', null])
    expect(await run(503, { error: { code: 'STORE_UNAVAILABLE' } })).toEqual([
      'uncertain',
      'STORE_UNAVAILABLE',
    ])
    expect(await run(410, { error: { code: 'EXPIRED' } })).toEqual(['expired', 'EXPIRED'])
    expect(await run(410, { error: { code: 'ACTION_EXPIRED' } })).toEqual([
      'action_expired',
      'ACTION_EXPIRED',
    ])
    expect(await run(409, { error: { code: 'ACTION_STALE' } })).toEqual([
      'action_stale',
      'ACTION_STALE',
    ])
  })

  it('토큰은 Authorization 헤더로만 보내고 URL에는 넣지 않으며 after_seq는 200을 넘지 않는다', async () => {
    const { createChatClient } = await import('../api/client')
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ run: {}, events: [] }), { status: 200 }),
    ) as unknown as typeof fetch
    await createChatClient({ fetchImpl }).getRun('sid.secret', 'run-1', 999)
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('/api/v2/chat/runs/run-1?after_seq=200')
    expect(String(url)).not.toContain('secret')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer sid.secret' })
  })
})
