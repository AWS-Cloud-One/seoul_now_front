import type { RunRequest } from '../api/types'

/**
 * Same-origin localStorage for the anonymous V2 session. Keys are separated from V1 and per
 * build mode/API base, so dev and deployed builds never share a token. This is not an account
 * login: clearing storage or switching devices cannot recover ownership of old conversations.
 *
 * Messages are NOT cached here: the timeline is restored from the server's messages API.
 * There is no conversation list API, so only the current conversation ID is kept.
 */
export type StoredPending = {
  conversation_id: string
  body: RunRequest
  text: string | null
  label?: string | null
}

export type StoredChat = {
  session: { token: string; expires_at: string } | null
  conversation_id: string | null
  /** A submitted request whose response never arrived; resent unchanged to confirm it. */
  pending: StoredPending | null
}

export const emptyStored = (): StoredChat => ({
  session: null,
  conversation_id: null,
  pending: null,
})

export interface ChatStorage {
  readonly key: string
  load(): StoredChat
  save(value: StoredChat): void
}

export function storageKey(mode: string, baseUrl: string) {
  return `bgsj.chatV2.v1:${mode}:${baseUrl}`
}

export function createLocalStorage(key: string): ChatStorage {
  return {
    key,
    load() {
      try {
        const raw = window.localStorage.getItem(key)
        if (!raw) return emptyStored()
        const value = JSON.parse(raw) as Partial<StoredChat>
        return {
          session: value.session && typeof value.session.token === 'string' ? value.session : null,
          conversation_id: typeof value.conversation_id === 'string' ? value.conversation_id : null,
          pending: value.pending ?? null,
        }
      } catch {
        return emptyStored()
      }
    },
    save(value) {
      try {
        // Only the known fields: an older build's run list is dropped on the next save.
        const { session, conversation_id, pending } = value
        window.localStorage.setItem(key, JSON.stringify({ session, conversation_id, pending }))
      } catch {
        // Private mode / quota: the chat still works for this tab.
      }
    },
  }
}

export function memoryStorage(initial: StoredChat = emptyStored()): ChatStorage {
  let value = initial
  return {
    key: 'memory',
    load: () => structuredClone(value),
    save: (next) => {
      value = structuredClone(next)
    },
  }
}
