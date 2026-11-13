import type { Route } from '../../hooks/useRoute'

/** Switch between the recommendation list and the AI conversation without leaving the panel. */
export function PanelTabs({
  route,
  go,
  recommendLabel = '추천 목록',
}: {
  route: 'recommend' | 'chat'
  go: (route: Route) => void
  recommendLabel?: string
}) {
  return (
    <div className="sn-tabs" role="tablist" aria-label="추천 패널 보기">
      {(
        [
          ['recommend', recommendLabel],
          ['chat', 'AI 대화'],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={route === key}
          className={route === key ? 'is-on' : ''}
          onClick={() => go(key)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
