import { useEffect, useState } from 'react'

export function useSecondsRemaining(until = 0) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!until) return
    const initial = window.setTimeout(() => setNow(Date.now()), 0)
    const timer = window.setInterval(() => {
      const next = Date.now()
      setNow(next)
      if (next >= until) window.clearInterval(timer)
    }, 250)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
  }, [until])
  return Math.max(0, Math.ceil((until - now) / 1000))
}
