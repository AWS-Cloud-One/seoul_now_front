import type { ReactNode } from 'react'
const icons: Record<string, ReactNode> = {
  fit: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 13 9 5 9-5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  home: <path d="m3 11 9-7.5 9 7.5M5.5 9.5V20h13V9.5M10 20v-6h4v6" />,
  sparkle: (
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.500 15.500 18 18M18 6l-2.500 2.500M8.500 15.500 6 18" />
  ),
  chevronLeft: <path d="m15 5-7 7 7 7" />,
  chevronRight: <path d="m9 5 7 7-7 7" />,
  chevronUp: <path d="m5 15 7-7 7 7" />,
  chevronDown: <path d="m5 9 7 7 7-7" />,
  back: <path d="M20 12H4m6-6-6 6 6 6" />,
  bookmark: <path d="M7 3h10a1 1 0 0 1 1 1v17l-6-4-6 4V4a1 1 0 0 1 1-1Z" />,
  bookmarkRemove: (
    <>
      <path d="M18 10V4a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1v17l6-4 3 2" />
      <path d="m16 14 6 6m0-6-6 6" />
    </>
  ),
  pin: (
    <>
      <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  chat: (
    <>
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.5 10 10 0 0 1-4-.9L3 21l1.7-5A8 8 0 0 1 3 11.5 8.5 8.5 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5Z" />
      <path d="M8 9h8M8 13h5" />
    </>
  ),
  map: (
    <>
      <path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Z" />
      <path d="M9 3v16M15 5v16" />
    </>
  ),
  list: (
    <>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.1M3 12h.1M3 18h.1" />
    </>
  ),
  coffee: (
    <>
      <path d="M4 8h13v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8ZM17 9h2a3 3 0 1 1 0 6h-2M7 3v2M12 3v2" />
    </>
  ),
  food: (
    <>
      <path d="M5 3v6a3 3 0 0 0 6 0V3M8 3v19M20 22V3c-5 3-5 10 0 10" />
    </>
  ),
  walk: (
    <>
      <circle cx="14" cy="4" r="2" />
      <path d="m7 13 3-5 5 2 3 4M11 9l-1 7-4 6M10 16l6 6M16 10l-2 6" />
    </>
  ),
  art: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="m3 16 6-6 5 5 3-3 4 4" />
      <circle cx="16" cy="7" r="1" />
    </>
  ),
  close: (
    <>
      <path d="m6 6 12 12M18 6 6 18" />
    </>
  ),
  arrow: (
    <>
      <path d="M4 12h16m-6-6 6 6-6 6" />
    </>
  ),
  parking: (
    <>
      <path d="m5 10 1.5-4a2 2 0 0 1 1.9-1.3h7.2a2 2 0 0 1 1.9 1.3L19 10" />
      <rect x="3" y="10" width="18" height="7" rx="2" />
      <path d="M6 17v2.5M18 17v2.5M7 13.5h.01M17 13.5h.01" />
    </>
  ),
  car: (
    <>
      <path d="m5 7 2-4h10l2 4 2 3v8H3v-8l2-3ZM3 10h18M6 18v3M18 18v3M6 14h2M16 14h2" />
    </>
  ),
  locate: (
    <>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>
  ),
  edit: (
    <>
      <path d="m15 4 5 5M4 15 16 3a2 2 0 0 1 5 5L9 20l-6 1 1-6Z" />
    </>
  ),
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 3-7M3 3v6h6M12 7v5l3 2" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 7a9 9 0 0 0-15-2L2 8M2 2v6h6M4 17a9 9 0 0 0 15 2l3-3M22 22v-6h-6" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14M5 12h14" />
    </>
  ),
  minus: (
    <>
      <path d="M5 12h14" />
    </>
  ),
  send: (
    <>
      <path d="m3 3 19 9-19 9 4-9-4-9ZM7 12h15" />
    </>
  ),
  leaf: (
    <>
      <path d="M20 3C7 2 2 8 6 15s16 1 14-12ZM4 21 16 8" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="7" r="3" />
      <path d="M3 21v-4a6 6 0 0 1 12 0v4M16 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5v2" />
    </>
  ),
  pause: (
    <>
      <path d="M9 5v14M15 5v14" />
    </>
  ),
  play: (
    <>
      <path d="m8 4 12 8-12 8V4Z" />
    </>
  ),
  check: (
    <>
      <path d="m5 12 4 4L19 6" />
    </>
  ),
}
export default function Icon({ name }: { name: string }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icons[name] || icons.pin}
    </svg>
  )
}
