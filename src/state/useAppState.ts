import { useContext } from 'react'
import { AppStateContext } from './appState'
export function useAppState() {
  const context = useContext(AppStateContext)
  if (!context) throw new Error('AppStateProvider is required')
  return context
}
