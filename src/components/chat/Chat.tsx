import { useEffect, useRef, useState } from 'react'
import { conditionText, dateLabel, placeById } from '../../lib/domain.js'
import { useAppState } from '../../state/useAppState'
import type { Result } from '../../types/trip'
import ChatClarification from './ChatClarification'
import RecommendationFeedback from '../recommendation/RecommendationFeedback'
import Icon from '../common/Icon'
import PlacePhoto from '../common/PlacePhoto'

export function CategoryArt({ category }: { category: string }) {
  const palettes: Record<string, string[]> = {
    카페: ['#eee3d2', '#93674a', '#fbf5e9'],
    식사: ['#f1dfd2', '#ac684b', '#fff5e9'],
    산책: ['#e3e8dc', '#65795e', '#f3f4e8'],
    전시: ['#e5e4ed', '#77718e', '#f8f5ee'],
  }
  const [background, foreground, light] = palettes[category] || palettes.카페
  return (
    <svg
      viewBox="0 0 300 140"
      focusable="false"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <rect width="300" height="140" fill={background} />
      <circle cx="245" cy="30" r="55" fill={light} opacity=".6" />
      <path d="M0 112 300 85V140H0" fill={foreground} opacity=".11" />
      {category === '카페' ? (
        <>
          <rect x="105" y="24" width="95" height="98" rx="48" fill={light} />
          <path d="M123 61h54v28q0 24-27 24t-27-24Z" fill={foreground} />
          <path d="M177 66h9q17 13-9 24" fill="none" stroke={foreground} strokeWidth="6" />
          <path
            d="M132 115h43M143 51q-7-8 0-15m14 15q-7-8 0-15"
            stroke={foreground}
            fill="none"
            strokeWidth="3"
          />
        </>
      ) : category === '산책' ? (
        <>
          <path d="M98 140q40-37 86-34t60-27" stroke={light} fill="none" strokeWidth="20" />
          <path d="M105 43v75M197 29v63" stroke={foreground} strokeWidth="5" />
          <ellipse cx="105" cy="56" rx="28" ry="38" fill={foreground} />
          <ellipse cx="197" cy="39" rx="25" ry="33" fill={foreground} opacity=".7" />
          <circle cx="151" cy="28" r="15" fill={light} />
        </>
      ) : category === '전시' ? (
        <>
          <rect x="83" y="24" width="140" height="96" fill={light} />
          <rect x="100" y="38" width="43" height="58" fill={foreground} />
          <path d="m107 82 14-27 16 27Z" fill={background} />
          <rect x="158" y="38" width="46" height="58" fill={background} />
          <circle cx="182" cy="65" r="15" fill={foreground} />
          <path d="M77 122h155" stroke={foreground} strokeWidth="3" />
        </>
      ) : (
        <>
          <circle cx="151" cy="74" r="49" fill={light} />
          <circle cx="151" cy="74" r="35" fill="none" stroke={foreground} strokeWidth="2" />
          <path d="M132 79q22-33 38 0Z" fill={foreground} />
          <path
            d="M86 32v82m-5-82v24h10V32M217 32v82m-5-82v36h5"
            stroke={foreground}
            strokeWidth="3"
            fill="none"
          />
        </>
      )}
    </svg>
  )
}

export function ChatRecommendation({ result }: { result: Result }) {
  const { active, ui, patchUI, openDetail } = useAppState()
  const track = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)
  const drag = useRef<{ start: number; scroll: number; moved: boolean } | null>(null)
  function move(delta: number) {
    const element = track.current
    if (!element) return
    const next = Math.max(0, Math.min(result.entries.length - 1, index + delta))
    element.scrollTo({
      left: next * ((element.firstElementChild?.getBoundingClientRect().width || 220) + 12),
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    })
  }
  const current = result.id === active.current || result.id === active.general?.id
  return (
    <div
      className={`chat-recommendation ${current ? 'is-current' : ''} ${current && active.retainedResult?.id === result.id ? 'is-retained' : ''}`}
      data-result={result.id}
      role="group"
      aria-label={`${result.number ? '추천 ' + result.number : '일반 후보'} 추천 카드`}
    >
      <div className="chat-recommendation-label">
        <span>
          {result.number
            ? `${result.conditions.departure} · ${result.conditions.purposes.join('·')} ${result.number}`
            : '이동시간 확인 중'}
        </span>
        <span>
          {current
            ? active.retainedResult?.id === result.id
              ? '이전 추천 유지'
              : '현재 추천'
            : '이전 추천'}
        </span>
      </div>
      <div
        className="chat-place-list"
        ref={track}
        tabIndex={0}
        aria-label="추천 장소 카드. 좌우 방향키로 넘기기"
        onScroll={(e) => {
          const element = e.currentTarget
          const maxScroll = element.scrollWidth - element.clientWidth
          setIndex(
            maxScroll > 1 && element.scrollLeft >= maxScroll - 2
              ? result.entries.length - 1
              : Math.round(
                  element.scrollLeft /
                    ((element.firstElementChild?.getBoundingClientRect().width || 220) + 12),
                ),
          )
        }}
        onKeyDown={(e) => {
          if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) {
            e.preventDefault()
            move(
              e.key === 'Home'
                ? -result.entries.length
                : e.key === 'End'
                  ? result.entries.length
                  : e.key === 'ArrowRight'
                    ? 1
                    : -1,
            )
          }
        }}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse')
            drag.current = { start: e.clientX, scroll: e.currentTarget.scrollLeft, moved: false }
        }}
        onPointerMove={(e) => {
          if (!drag.current || !e.buttons) return
          const delta = e.clientX - drag.current.start
          if (Math.abs(delta) > 5) drag.current.moved = true
          if (drag.current.moved) {
            e.currentTarget.scrollLeft = drag.current.scroll - delta
            e.preventDefault()
          }
        }}
        onPointerUp={() => {
          setTimeout(() => {
            drag.current = null
          }, 0)
        }}
        onPointerLeave={() => {
          drag.current = null
        }}
      >
        {result.entries.map((entry, i) => {
          const place = placeById(entry.id, result)
          if (!place) return null
          const selected = current && active.selected === entry.id
          return (
            <button
              className={`chat-place-card ${selected ? 'selected' : ''} ${current && ui.hover === entry.id ? 'is-place-preview' : ''}`}
              key={entry.id}
              data-id={entry.id}
              data-group={result.id}
              aria-label={`${i + 1}/${result.entries.length} ${place.name} 장소 보기`}
              aria-pressed={selected}
              draggable={false}
              onMouseEnter={() => current && patchUI({ hover: entry.id })}
              onMouseLeave={() => patchUI({ hover: null })}
              onFocus={() => current && patchUI({ hover: entry.id })}
              onBlur={() => patchUI({ hover: null })}
              onClick={() => {
                if (!drag.current?.moved) openDetail(entry.id, result.id)
              }}
            >
              <PlacePhoto
                url={entry.photoUrl || place.photoUrl}
                name={place.name}
                fallback={<CategoryArt category={place.category} />}
              />
              <span className="recommendation-rank">
                <b>{i + 1}</b>
                추천
              </span>
              <span className="category-card-body">
                <span className="carousel-card-heading">
                  <strong>{place.name}</strong>
                  <span className="card-selection-mark">
                    <Icon name="pin" />
                    선택
                  </span>
                </span>
                <span className="chat-place-meta">
                  <Icon name="pin" />
                  서울 {place.area} · {place.category}
                  {active.excluded.includes(entry.id) ? ' · 다음 추천에서 제외' : ''}
                </span>
                {!result.api && (
                  <span
                    className="recommendation-rating"
                    title="시연용 예시 평점 · 실제 이용자 평점 아님"
                  >
                    <span aria-hidden="true">★</span> {i === 0 ? '4.7' : '4.5'}{' '}
                    <small>({i === 0 ? '328' : '219'})</small>
                    <small className="rating-demo">예시</small>
                  </span>
                )}
                <span className="chat-place-reason">{place.description || entry.reason}</span>
                <span className="carousel-card-footer">
                  <span className="chat-place-eta">
                    {entry.eta === null ? (
                      <small>이동시간 미확인</small>
                    ) : (
                      <>
                        <Icon name="car" />
                        <small>차로</small> <span>{entry.eta}분</span>
                      </>
                    )}
                  </span>
                  <span className="carousel-card-link">
                    장소 보기 <Icon name="arrow" />
                  </span>
                </span>
              </span>
            </button>
          )
        })}
      </div>
      <div className="carousel-navigation">
        <span className="carousel-hint">
          {result.entries.length > 1 ? '옆으로 넘겨보세요' : '추천 장소를 살펴보세요'}
        </span>
        <div className="carousel-actions">
          <output className="carousel-count" aria-live="polite" aria-label="보고 있는 카드">
            {Math.min(index + 1, result.entries.length)} / {result.entries.length}
          </output>
          {result.entries.length > 1 && (
            <>
              <button
                className="carousel-arrow previous"
                aria-label="이전 장소 카드"
                disabled={index === 0}
                onClick={() => move(-1)}
              >
                <Icon name="arrow" />
              </button>
              <button
                className="carousel-arrow"
                aria-label="다음 장소 카드"
                disabled={index >= result.entries.length - 1}
                onClick={() => move(1)}
              >
                <Icon name="arrow" />
              </button>
            </>
          )}
        </div>
      </div>
      <span className="chat-recommendation-time">
        {dateLabel(result.time)} 조회{!result.api && ' · 예시 장소'}
      </span>
    </div>
  )
}

export function SearchProgress() {
  const { active, ui } = useAppState()
  const progress = ui.progress
  if (!ui.busy || !progress) return null
  const stages = [
    ['conditions', '조건 확인'],
    ['regions', '지역 탐색'],
    ['places', '장소 탐색'],
    ['routes', '이동·주차'],
    ['ranking', '추천 정리'],
  ]
  const current = stages.findIndex(([id]) => id === progress.stage)
  return (
    <section className="search-progress" aria-label="요청 처리 진행">
      <div className="search-progress-heading">
        <span className="search-spinner" aria-hidden="true" />
        <strong>
          {progress.mode === 'search'
            ? '다음 목적지를 찾고 있어요'
            : progress.mode === 'question'
              ? '질문을 확인하고 있어요'
              : progress.mode === 'route'
                ? '이동시간을 다시 확인하고 있어요'
                : '메시지를 읽고 있어요'}
        </strong>
        {!active.api && <span className="search-demo">모의 응답</span>}
      </div>
      {progress.conditions && (
        <p className="search-request-summary">{conditionText(progress.conditions)}</p>
      )}
      {progress.mode === 'search' && (
        <ol className="search-steps">
          {stages.map(([id, label], i) => (
            <li
              key={id}
              className={i < current ? 'complete' : i === current ? 'active' : 'upcoming'}
              aria-current={i === current ? 'step' : undefined}
            >
              <span className="search-step-dot">{i < current ? '✓' : i + 1}</span>
              <span>{label}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="search-progress-detail" role="status">
        {progress.detail}
      </p>
    </section>
  )
}

export default function Chat({ embedded = true }: { embedded?: boolean }) {
  const { active, result, ui, submitChat, updateChatDraft, openEdit, closePanel } = useAppState()
  const log = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const displayedResult = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!log.current) return
    if (result?.id !== displayedResult.current) {
      displayedResult.current = result?.id
      log.current.scrollTop = 0
      stickToBottom.current = false
    } else if (stickToBottom.current) {
      log.current.scrollTop = log.current.scrollHeight
    }
  }, [result?.id, active.chat.length, ui.busy, ui.progress?.stage])
  const selected = placeById(active.selected, result)
  const need = active.pendingChat?.need
  const samples =
    need === 'departure'
      ? ['서울역', '강남역', '홍대입구역']
      : need === 'headcount'
        ? ['2명', '4명', '6명']
        : need === 'purposes'
          ? ['카페', '식사', '산책']
          : result
            ? ['다른 곳 추천해줘', '왜 추천했어?', '식사로 바꾸고 40분까지']
            : ['서울역에서 카페', '강남역에서 전시', '홍대입구역에서 산책']
  const latestMessage = active.chat.at(-1)
  const latestRecommendationIndex = active.chat
    .map((message) => message.resultId)
    .lastIndexOf(result?.id)
  const showReply =
    !ui.busy &&
    latestMessage?.role === 'assistant' &&
    (!latestMessage.resultId || !!latestMessage.taskResults?.length) &&
    (!result ||
      active.chat.length - 1 > latestRecommendationIndex ||
      (!!latestMessage.taskResults?.length && latestMessage.resultId === result.id))
  return (
    <div className="dialog-inner">
      <header className="dialog-head chat-head">
        <span className="guide-mark">
          <img
            className="chat-guide-avatar"
            src={`${import.meta.env.BASE_URL}images/chat-guide-cat-cutout.png`}
            alt=""
          />
        </span>
        <div className="chat-heading-copy">
          <h2 id={embedded ? 'guide-title' : 'panel-title'}>추천해줄게!</h2>
          <p>오늘은 어디로 떠나볼까?</p>
        </div>
        <button className="chat-options-button" onClick={openEdit} disabled={ui.busy}>
          <Icon name="edit" />
          조건 직접 입력
        </button>
        {!embedded && (
          <button className="quiet close-btn" aria-label="대화 닫기" onClick={closePanel}>
            <Icon name="close" />
          </button>
        )}
      </header>
      <div className="chat-context">
        {selected ? (
          <>
            <span className="context-caption">함께 보고 있는 장소</span>
            <strong className="context-current">
              <Icon name="pin" />
              {selected.name}
            </strong>
          </>
        ) : (
          <strong>지도를 보며 함께 골라볼까요?</strong>
        )}
        {!embedded && <p>{conditionText(active.conditions)}</p>}
        {(active.pendingChat || active.api?.clarification) && (
          <div className="context-place">
            아직 적용하지 않은 요청이 있어요. 추가 답변을 기다리고 있어요.
          </div>
        )}
      </div>
      <div
        className="chat-messages"
        aria-label="대화 기록"
        role="log"
        ref={log}
        onScroll={(e) => {
          const element = e.currentTarget
          stickToBottom.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 55
        }}
      >
        {!active.chat.length && (
          <section className="chat-welcome">
            <span className="welcome-eyebrow">오늘의 다음 목적지</span>
            <h2>오늘, 어디로 가볼까요?</h2>
            <p>
              어디서 출발하는지, 무엇을 하고 싶은지
              <br />
              편하게 이야기해 주세요.
            </p>
            <div className="chat-starters">
              {[
                ['coffee', '커피 한 잔의 여유', '서울역에서 카페, 차로 30분 이내'],
                ['walk', '가볍게 걷고 싶은 날', '홍대입구역에서 산책'],
                ['art', '새로운 영감이 필요할 때', '강남역에서 전시'],
              ].map(([icon, title, text]) => (
                <button className="chat-starter" key={title} onClick={() => void submitChat(text)}>
                  <span className="starter-icon">
                    <Icon name={icon} />
                  </span>
                  <span>
                    <strong>{title}</strong>
                    <small>{text}</small>
                  </span>
                  <Icon name="arrow" />
                </button>
              ))}
            </div>
          </section>
        )}
        {result && (
          <div className="chat-message has-recommendation">
            <ChatRecommendation key={result.id} result={result} />
          </div>
        )}
        {showReply && latestMessage && (
          <div className="chat-message chat-answer" role="region" aria-label="챗봇 답변">
            <div className="chat-answer-heading">
              <span>
                <img
                  className="chat-guide-avatar"
                  src={`${import.meta.env.BASE_URL}images/chat-guide-cat.png`}
                  alt=""
                />
              </span>
              <strong>챗봇 답변</strong>
              {latestMessage.place && <small>{latestMessage.place}</small>}
            </div>
            <p>{latestMessage.text}</p>
          </div>
        )}
        <ChatClarification />
        <RecommendationFeedback />
        <div className="chat-progress-host">
          <SearchProgress />
        </div>
      </div>
      <div className="chat-samples" aria-label="대화 예시">
        {samples.map((text) => (
          <button
            key={text}
            disabled={ui.busy}
            onClick={() => {
              stickToBottom.current = true
              void submitChat(text)
            }}
          >
            {text}
          </button>
        ))}
      </div>
      <div className="chat-compose">
        <form
          id="chat-form"
          onSubmit={(e) => {
            e.preventDefault()
            stickToBottom.current = true
            void submitChat(active.workspaceView?.chatDraft || '')
          }}
        >
          <label className="sr-only" htmlFor="chat-input">
            대화 메시지
          </label>
          <textarea
            id="chat-input"
            rows={2}
            maxLength={500}
            value={active.workspaceView?.chatDraft || ''}
            onChange={(e) => updateChatDraft(e.target.value)}
            placeholder="원하는 조건이나 궁금한 점을 말해보세요"
            onKeyDown={(e) => {
              if (
                e.key === 'Enter' &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                e.keyCode !== 229
              ) {
                e.preventDefault()
                stickToBottom.current = true
                void submitChat(active.workspaceView?.chatDraft || '')
              }
            }}
          />
          <button
            className="primary liquid-glass-send"
            type="submit"
            aria-label="메시지 보내기"
            disabled={ui.busy}
          >
            <Icon name="send" />
          </button>
        </form>
      </div>
    </div>
  )
}
