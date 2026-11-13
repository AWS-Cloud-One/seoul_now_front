import { useEffect, useEffectEvent, useState } from 'react'
import { PanelTabs } from '../../components/common/PanelTabs'
import { EmptyState, PanelHeader, PrimaryButton, SecondaryButton } from '../../components/common/ui'
import type { Route } from '../../hooks/useRoute'
import { conditionLine, clock } from '../model/labels'
import { resultOrdinals } from '../model/turns'
import {
  latestRecommendation,
  removeRecommendation,
  selectRecommendation,
  useSavedRecommendations,
  useSelectedRecommendation,
} from '../state/recommendations'
import { useChatController, useChatState } from '../state/useChat'
import { RecommendationResult } from './RecommendationResult'
import OriginForm from '../../components/origin/OriginForm'
import { useOrigin } from '../../state/origin'

const PURPOSES = ['카페', '식사', '산책', '전시']
export type RecommendationNotice = (
  message: string,
  action?: { label: string; onClick: () => void },
) => void
/** A form is another way to compose a V2 request, not a separate recommendation engine. */
function SearchForm({ go }: { go: (route: Route) => void }) {
  const controller = useChatController()
  const state = useChatState()
  const [area, setArea] = useState(
    state.snapshot?.search_area?.kind === 'radius'
      ? `${state.snapshot.search_area.anchor!.name} 반경 ${state.snapshot.search_area.radius_m}m`
      : (state.snapshot?.search_area?.query ?? state.snapshot?.search_area?.label ?? ''),
  )
  const [purposes, setPurposes] = useState<string[]>([])
  const [people, setPeople] = useState('')
  const [mode, setMode] = useState<'regional' | 'driving'>('regional')
  const [travel, setTravel] = useState('30')
  const [extra, setExtra] = useState('')
  const origin = useOrigin()
  const valid = purposes.length > 0 && (mode === 'regional' ? !!area.trim() : !!origin.location)
  return (
    <form
      className="sn-chat-search-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (!valid || !controller.canSend) return
        const base =
          mode === 'regional'
            ? `${area.trim()} 안에서, 출발지와 이동시간 제한 없이`
            : `${origin.location!.label}에서 출발해서 차로 ${travel}분 이내에 갈 수 있는 서울의`
        const text = `${base} ${purposes.join('와 ')} 추천해줘${people ? `. 인원은 ${people}명` : ''}${extra.trim() ? `. ${extra.trim()}` : ''}`
        // This is a new search, not an answer to an earlier clarification.
        void controller.send(text, { replyTo: null })
        selectRecommendation(null)
        go('chat')
      }}
    >
      <fieldset>
        <legend>어떻게 찾을까요?</legend>
        <div className="sn-chips">
          <button
            className="sn-filter-chip"
            type="button"
            aria-pressed={mode === 'regional'}
            onClick={() => setMode('regional')}
          >
            지역 안에서
          </button>
          <button
            className="sn-filter-chip"
            type="button"
            aria-pressed={mode === 'driving'}
            onClick={() => setMode('driving')}
          >
            출발지에서 가까운 곳
          </button>
        </div>
      </fieldset>
      {mode === 'regional' ? (
        <label>
          찾을 지역
          <input
            value={area}
            onChange={(event) => setArea(event.target.value)}
            placeholder="예: 성수, 강남, 서울역 근처"
            maxLength={100}
            required
          />
        </label>
      ) : (
        <>
          <fieldset>
            <legend>출발지</legend>
            <OriginForm />
          </fieldset>
          <label>
            자동차 이동시간
            <select value={travel} onChange={(event) => setTravel(event.target.value)}>
              {[15, 30, 45, 60, 90, 120].map((n) => (
                <option key={n} value={n}>
                  {n}분 이내
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <fieldset>
        <legend>
          하고 싶은 일 <small>최대 2개</small>
        </legend>
        <div className="sn-chips">
          {PURPOSES.map((purpose) => (
            <button
              type="button"
              key={purpose}
              className="sn-filter-chip"
              aria-pressed={purposes.includes(purpose)}
              onClick={() =>
                setPurposes((current) =>
                  current.includes(purpose)
                    ? current.filter((p) => p !== purpose)
                    : current.length < 2
                      ? [...current, purpose]
                      : current,
                )
              }
            >
              {purpose}
            </button>
          ))}
        </div>
      </fieldset>
      <details>
        <summary>추가 조건</summary>
        <label>
          인원
          <select value={people} onChange={(event) => setPeople(event.target.value)}>
            <option value="">현재 대화 설정 유지</option>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}명
              </option>
            ))}
          </select>
        </label>
        <label>
          동행·연령대·그 밖의 요청
          <input
            value={extra}
            onChange={(event) => setExtra(event.target.value)}
            placeholder="예: 30대 친구들과, 주차 가능한 곳"
            maxLength={500}
          />
        </label>
      </details>
      <p className="sn-note">
        {mode === 'regional'
          ? '출발지 없이 지역 안의 장소를 찾아요. 이동시간은 길찾기에서 확인할 수 있어요.'
          : '선택한 출발지와 이동시간을 대화에 전달해요. 출발지가 모호하면 한 번 더 확인해요.'}{' '}
        추가 조건은 대화에서 이어서 바꿀 수 있어요.
      </p>
      <PrimaryButton type="submit" disabled={!valid || !controller.canSend}>
        이 조건으로 추천받기
      </PrimaryButton>
      <SecondaryButton type="button" onClick={() => go('chat')}>
        대화로 조건 말하기
      </SecondaryButton>
    </form>
  )
}

export function RecommendationPanel({
  go,
  onShowMap,
  onNotify,
}: {
  go: (route: Route) => void
  onShowMap?: () => void
  onNotify?: RecommendationNotice
}) {
  const state = useChatState()
  const saved = useSavedRecommendations()
  const selectedId = useSelectedRecommendation()
  const selected = saved.find((item) => item.recommendation.result_id === selectedId)
  const latest = latestRecommendation(state.turns)
  const fromHistory = state.turns.find(
    (turn) => turn.run?.response?.recommendation?.result_id === selectedId,
  )?.run?.response?.recommendation
  const recommendation = selected?.recommendation ?? fromHistory ?? latest
  const [editing, setEditing] = useState(false)
  const previousResultId =
    !editing && !selected && fromHistory?.result_id !== latest?.result_id
      ? fromHistory?.result_id
      : undefined
  const notifyPreviousResult = useEffectEvent(() => {
    onNotify?.('이전에 선택한 추천 묶음이에요.', {
      label: '최신 추천 보기',
      onClick: () => selectRecommendation(null),
    })
  })
  useEffect(() => {
    if (previousResultId) notifyPreviousResult()
  }, [previousResultId])
  return (
    <>
      <PanelTabs route="recommend" go={go} />
      <PanelHeader
        title="추천 목록"
        subtitle="조건 입력과 AI 대화에서 찾은 장소를 여기서 확인해요"
        actions={
          recommendation && (
            <SecondaryButton className="is-compact" onClick={() => setEditing(!editing)}>
              {editing ? '목록 보기' : '조건으로 찾기'}
            </SecondaryButton>
          )
        }
      />
      <div className="sn-scroll sn-chat-recommend-panel">
        {selected && !editing && (
          <div className="sn-banner">
            <p>
              {clock(selected.savedAt)}에 저장한 추천 묶음이에요. 이동·주차 정보는 당시 조회
              값이에요.
            </p>
            <SecondaryButton onClick={() => selectRecommendation(null)}>
              현재 대화의 추천 보기
            </SecondaryButton>
          </div>
        )}
        {recommendation && !editing && (
          <RecommendationResult
            recommendation={recommendation}
            ordinal={
              selected?.ordinal ?? resultOrdinals(state.turns).get(recommendation.result_id) ?? 1
            }
            onShowMap={onShowMap}
            readOnly={!!selected}
          />
        )}
        {(!recommendation || editing) && <SearchForm go={go} />}
        {state.turns.some(
          (turn) =>
            turn.phase === 'tracking' || turn.phase === 'sending' || turn.phase === 'unconfirmed',
        ) && <SecondaryButton onClick={() => go('chat')}>진행 중인 요청 보기</SecondaryButton>}
      </div>
    </>
  )
}

export function SavedRecommendations({ go }: { go: (route: Route) => void }) {
  const saved = useSavedRecommendations()
  const [error, setError] = useState('')
  return (
    <>
      <PanelHeader
        title="저장한 추천"
        count={saved.length}
        subtitle="추천 묶음을 이 브라우저에 보관해요"
      />
      <div className="sn-scroll">
        {error && <p role="alert">{error}</p>}
        {saved.length ? (
          <ul className="sn-list">
            {saved.map((item) => (
              <li className="sn-saved-card" key={item.recommendation.result_id}>
                <button
                  type="button"
                  className="sn-place-main"
                  onClick={() => {
                    selectRecommendation(item.recommendation.result_id)
                    go('recommend')
                  }}
                >
                  <span className="sn-place-body">
                    <strong>
                      {item.recommendation.search_area?.label ?? '서울'} 추천 ·{' '}
                      {item.recommendation.cards.length}곳
                    </strong>
                    <span className="sn-place-meta">
                      {conditionLine(item.recommendation.effective_conditions)}
                    </span>
                    <span>
                      {item.recommendation.cards
                        .map((card) => card.place.value?.name)
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    <span className="sn-place-meta">{clock(item.savedAt)} 저장</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="sn-link"
                  aria-label={`${item.recommendation.search_area?.label ?? '서울'} 추천 묶음 저장 취소`}
                  onClick={() => {
                    if (!removeRecommendation(item.recommendation.result_id))
                      setError('브라우저 저장소에 접근하지 못했어요. 다시 시도해 주세요.')
                  }}
                >
                  저장 취소
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="저장한 추천 묶음이 없어요">
            추천 결과의 ‘추천 묶음 저장’을 누르면 다시 볼 수 있어요.
            <br />
            <PrimaryButton onClick={() => go('recommend')}>추천받으러 가기</PrimaryButton>
          </EmptyState>
        )}
      </div>
    </>
  )
}
