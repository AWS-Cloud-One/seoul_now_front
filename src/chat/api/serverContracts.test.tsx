import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ChatPanel from '../components/ChatPanel'
import { ChatController } from '../state/controller'
import { memoryStorage } from '../state/storage'
import { createChatClient } from './client'
import bundle from './fixtures/server-examples.json'

const controllers: ChatController[] = []
afterEach(() => controllers.splice(0).forEach((controller) => controller.dispose()))

// Produced by AWS_back/test_chat_v2_contract_bundle on disposable PostGIS.
// Providers and places are synthetic; this tests server wire data, not mockClient output.
describe('server HTTP contract handoff', () => {
  for (const name of ['success', 'question', 'partial', 'cancelled'] as const) {
    it(`${name}: restores a real server response through the HTTP adapter`, async () => {
      const example = structuredClone(bundle.cases[name])
      example.snapshot.expires_at = '2099-01-01T00:00:00Z'
      const client = createChatClient({
        fetchImpl: async (url) => {
          const path = String(url)
          const body = path.includes('/messages')
            ? example.history
            : path.includes('/runs/')
              ? example.poll
              : example.snapshot
          return new Response(JSON.stringify(body), { status: 200 })
        },
      })
      const controller = new ChatController({
        client,
        storage: memoryStorage({
          session: { token: 'synthetic', expires_at: '2099-01-01T00:00:00Z' },
          conversation_id: example.snapshot.conversation_id,
          pending: null,
        }),
      })
      controllers.push(controller)
      render(<ChatPanel go={() => {}} controller={controller} />)
      await waitFor(() => expect(controller.getState().history.loading).toBe(false))
      await waitFor(() =>
        expect(controller.getState().turns.length).toBe(example.history.items.length),
      )
      expect(controller.getState().turns.at(-1)?.run?.response?.answer).toBe(
        example.poll.run.response.answer,
      )
      expect(screen.getByRole('log')).not.toHaveTextContent('서버 응답을 해석하지 못했어요')
      if (name === 'question')
        expect(screen.getAllByRole('button', { name: '3명' }).length).toBeGreaterThan(0)
      if (name === 'success') expect(screen.getByText('검증 카페')).toBeInTheDocument()
      if (name === 'partial') expect(screen.getAllByText('일부 완료').length).toBeGreaterThan(0)
      if (name === 'cancelled') expect(screen.getByText('요청을 중단했어요')).toBeInTheDocument()
    })
  }

  it('expired: maps the server 410 body to conversation expiry', async () => {
    const example = bundle.cases.expired
    const client = createChatClient({
      fetchImpl: async () =>
        new Response(JSON.stringify(example.body), { status: example.http_status }),
    })
    await expect(client.getConversation('synthetic', 'expired')).rejects.toMatchObject({
      kind: 'expired',
      status: 410,
      code: 'EXPIRED',
    })
  })

  it('429 is a definite rejection, not an uncertain submission to replay', async () => {
    const client = createChatClient({
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: { code: 'RATE_LIMITED' } }), { status: 429 }),
    })
    await expect(client.createSession()).rejects.toMatchObject({
      kind: 'rate_limited',
      status: 429,
    })
  })
})
