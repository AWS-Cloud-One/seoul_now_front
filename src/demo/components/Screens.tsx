import { useEffect, useState } from 'react'
import assets from '../data/assets.json'
import { useDemo } from '../useDemo'
import { validateConditions } from '../domain.js'
import Onboarding from './Onboarding'
import Icon from './Icon'
import MapPanel from './MapPanel'
import { SavedTripsButton } from './SavedTrips'

const image = (path: string) => `${import.meta.env.BASE_URL}${path}`
export function StartScreen() {
  const { navigate } = useDemo()
  return (
    <section id="start-screen" className="start-screen" aria-labelledby="start-screen-title">
      <picture className="start-screen-photo" aria-hidden="true">
        <source media="(max-width:900px)" srcSet={image('images/seoul-portrait.png')} />
        <img src={image('images/seoul-wide.png')} alt="" fetchPriority="high" />
      </picture>
      <div className="start-screen-inner">
        <div className="start-screen-brand">SEOUL NOW</div>
        <div className="start-screen-copy">
          <h1 id="start-screen-title">
            SEOUL,
            <br />
            지금 어디?
          </h1>
          <p>
            실시간 교통 및 주차 데이터를 바탕으로
            <br />
            가장 완벽한 동선의 서울 장소를 제안합니다.
          </p>
        </div>
        <div className="start-screen-bottom">
          <button
            type="button"
            id="start-screen-button"
            className="start-screen-button"
            onClick={() => navigate('preview')}
          >
            시작하기{' '}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="m9 4 8 8-8 8" />
            </svg>
          </button>
          <p className="start-screen-tagline">SEOUL, WHERE NEXT</p>
        </div>
      </div>
    </section>
  )
}
export function PreviewScreen() {
  const [form, setForm] = useState(false)
  return (
    <main id="main" tabIndex={-1}>
      <MapPanel preview />
      <aside className="map-preview-sidebar" aria-label="챗봇 메뉴">
        <button
          type="button"
          className="map-preview-chat"
          id="map-preview-chat"
          aria-label="챗봇 열기"
          title="챗봇"
          aria-expanded={form}
          aria-controls="map-preview-form"
          onClick={() => setForm(!form)}
        >
          <Icon name="chat" />
        </button>
        <SavedTripsButton />
      </aside>
      {form && (
        <section
          className="map-preview-form"
          id="map-preview-form"
          aria-label="여행 조건 입력"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              setForm(false)
              document.getElementById('map-preview-chat')?.focus({ preventScroll: true })
            }
          }}
        >
          <button
            className="map-preview-form-close"
            aria-label="조건 입력 닫기"
            onClick={() => setForm(false)}
          >
            ×
          </button>
          <Onboarding />
        </section>
      )}
    </main>
  )
}
export function Welcome() {
  const { openEdit } = useDemo()
  const [gallery, setGallery] = useState(0)
  const [paused, setPaused] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    if (paused) return
    const timer = setInterval(() => {
      if (!document.hidden) setGallery((value) => 1 - value)
    }, 8000)
    return () => clearInterval(timer)
  }, [paused])
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const change = () => {
      if (media.matches) setPaused(true)
    }
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  return (
    <div className="welcome-content">
      <div className="welcome-scene">
        <figure
          className={`home-gallery ${gallery ? 'alternate' : ''}`}
          style={{ margin: 0 }}
          aria-label="서울 나들이 분위기 이미지"
        >
          <img
            className="first"
            src={image(assets.a)}
            alt="햇살과 나무 그늘이 드리운 벽돌 카페 골목의 AI 생성 풍경"
          />
          <img
            className="second"
            src={image(assets.b)}
            alt="남산타워가 멀리 보이는 초록 산책길의 AI 생성 풍경"
          />
          <span className="gallery-top">
            <Icon name="leaf" />
            조금 다른 하루가 기다리는 곳
          </span>
          <figcaption className="gallery-caption">
            <div className="gallery-progress" aria-hidden="true">
              <span className={gallery === 0 ? 'active' : ''} />
              <span className={gallery === 1 ? 'active' : ''} />
            </div>
            <p>
              멀리 가지 않아도,
              <br />
              여행 같은 순간.
            </p>
            <div className="row between">
              <details>
                <summary>분위기를 위한 이미지</summary>두 이미지는 AI로 만든 가상의 서울 풍경입니다.
                추천 장소의 실제 사진이 아닙니다.
              </details>
              <button
                className="small"
                onClick={() => setPaused(!paused)}
                aria-label={paused ? '배경 전환 재생' : '배경 전환 일시정지'}
              >
                <Icon name={paused ? 'play' : 'pause'} />
              </button>
            </div>
          </figcaption>
        </figure>
      </div>
      <div className="welcome-foot">
        <span>서울·인천·경기 출발 → 서울 도착</span>
        <button className="quiet small mobile-manual" onClick={openEdit}>
          <Icon name="edit" />
          조건 직접 선택
        </button>
      </div>
    </div>
  )
}
export function ScenarioControls() {
  const { active, ui, patchUI, search, notify } = useDemo()
  const scenarios: Record<string, string> = {
    normal: '기본 정상 응답',
    clarify: '조건 추가 확인',
    interpretation: '해석 실패',
    explanation: '추천 설명 실패',
    'route-partial': '경로 부분 실패',
    'route-all': '경로 전체 실패',
    empty: '첫 / 다음 결과 없음',
    'accepted-fail': '수락 후 처리 실패',
    unconfirmed: '수락 여부 미확인',
    map: '지도만 실패',
    missing: '오래된 / 누락 데이터',
    delay: '응답 지연',
  }
  return (
    <details className="scenario-panel">
      <summary>상태 확인</summary>
      <div className="scenario-inner">
        <p>다음 요청에 한 번 적용됩니다. 자동 재시도·자동 조건 완화는 하지 않아요.</p>
        <div className="row">
          <label htmlFor="scenario-select" className="sr-only">
            다음 모의 요청 상태
          </label>
          <select
            id="scenario-select"
            value={ui.scenario}
            onChange={(e) => patchUI({ scenario: e.target.value })}
          >
            {Object.entries(scenarios).map(([key, label]) => (
              <option value={key} key={key}>
                {label}
              </option>
            ))}
          </select>
          <button
            disabled={ui.busy}
            onClick={() =>
              validateConditions(active.conditions)
                ? notify('출발지와 목적을 먼저 입력해 주세요. 선택한 상태는 첫 추천에 적용됩니다.')
                : void search(active.conditions)
            }
          >
            이 상태로 새 탐색
          </button>
          <button onClick={() => patchUI({ mapError: true })}>지도 오류만 재현</button>
        </div>
        <p>
          <strong>반복 경로:</strong> 새 여행 → 서울역 / 카페 / 시간 제한 없음 → 첫 추천 후 ‘다른
          곳’ 5회. 기록은 최근 5개 그룹만 유지됩니다.
        </p>
        <p className="scenario-count">
          성공 그룹 누적 {active.sequence}개 · 다시 추천하지 않을 ID{' '}
          {new Set([...active.seen, ...active.excluded]).size}개 · 기록 {active.groups.length}/5개 ·
          임시 후보 {active.general?.entries.length || 0}개
        </p>
        <p>
          위치 거부·지역 밖은 ‘현재 위치’에서, 외부 앱 실패는 ‘길안내’에서 재현할 수 있어요. 지연 중
          ‘새 여행’을 만들면 늦은 응답을 무시합니다.
        </p>
        <p>
          추천 장소·이동시간은 모의 결과입니다. 도로·주차·인구 구역은 실제 공간자료이며, 도로 속도와
          인구는 보관 관측값입니다.
        </p>
      </div>
    </details>
  )
}
