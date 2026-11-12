import type { ReactNode } from 'react'

export default function ResponsePending({ children }: { children: ReactNode }) {
  return (
    <span className="sn-response-pending">
      <span className="sn-thinking-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>{children}</span>
    </span>
  )
}
