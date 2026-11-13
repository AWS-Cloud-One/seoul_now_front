import { createContext, useContext, useEffect, useSyncExternalStore } from 'react'
import { createChatClient } from '../api/client'
import { createMockChatClient } from '../api/mockClient'
import { ChatController } from './controller'
import { createLocalStorage, memoryStorage, storageKey } from './storage'

/** Real API by default. The in-memory adapter is an explicit screen-development option. */
export type ChatMode = 'real' | 'mock'
export function chatMode(value = import.meta.env.VITE_CHAT_MODE): ChatMode {
  return value === 'mock' ? 'mock' : 'real'
}

let shared: ChatController | null = null
/** One controller per page so the draft and polling survive panel/tab switches. */
export function sharedController(mode: ChatMode = chatMode()) {
  if (shared) return shared
  const baseUrl = import.meta.env.VITE_CHAT_BASE_URL?.trim() || '/api/v2/chat'
  shared =
    mode === 'mock'
      ? new ChatController({
          client: createMockChatClient({ stepsPerRun: 3 }),
          storage: memoryStorage(),
        })
      : new ChatController({
          client: createChatClient({ baseUrl }),
          storage: createLocalStorage(storageKey(import.meta.env.MODE, baseUrl)),
        })
  return shared
}

export const ChatContext = createContext<ChatController | null>(null)

export function useChatController() {
  const controller = useContext(ChatContext)
  if (!controller) throw new Error('ChatContext is missing')
  return controller
}

export function useChatState() {
  const controller = useChatController()
  return useSyncExternalStore(controller.subscribe, controller.getState, controller.getState)
}

/** Start on mount; re-check the server when the tab becomes visible or another tab changes it. */
export function useChatLifecycle(controller: ChatController) {
  useEffect(() => {
    controller.start()
    const visible = () => {
      if (!document.hidden) controller.onVisible()
    }
    const storage = (event: StorageEvent) => {
      if (event.key === controller.storageKey) controller.onStorageChange()
    }
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('storage', storage)
    return () => {
      document.removeEventListener('visibilitychange', visible)
      window.removeEventListener('storage', storage)
    }
  }, [controller])
}
