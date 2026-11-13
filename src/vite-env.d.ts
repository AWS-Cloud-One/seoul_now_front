/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_KAKAO_MAP_APP_KEY?: string
  /** Defaults to real; mock is for screen development only. */
  readonly VITE_CHAT_MODE?: string
  readonly VITE_CHAT_BASE_URL?: string
}
