import { lazy, Suspense, useState } from 'react'
import { conditionText, placeById } from '../domain.js'
import { useDemo } from '../useDemo'
import { LayerButtons } from './ConceptMap'
import Icon from './Icon'
import { SaveTripButton } from './SavedTrips'
const GeoMap = lazy(() => import('./GeoMap'))
const roadColors = [
  ['#d9544e', '20 미만'],
  ['#c58e24', '20–40'],
  ['#208973', '40 이상'],
  ['#8999aa', '미확인'],
]
function MapLegend({ preview = false }: { preview?: boolean }) {
  const { layers } = useDemo()
  return (
    <div id="map-layer-legend">
      <div className="map-source-summary">
        <span>실제 위치 자료</span>
        <span>저장본 시연</span>
      </div>
      {layers.roads && (
        <section className="map-layer-key">
          <strong>
            도로 교통량 <small>통행속도 기준</small>
          </strong>
          <div className="map-color-key">
            {roadColors.map(([color, label]) => (
              <span key={label}>
                <i style={{ background: color }} />
                {label}
              </span>
            ))}
          </div>
          <p>큰 도로부터 표시해요. 확대하면 주변 도로까지 보여요.</p>
          <p>단위 km/h · 2026.10.07 수신 자료</p>
        </section>
      )}
      <p className="map-layer-hint">서울·인접 지역 안에서 살펴볼 수 있어요.</p>
      {layers.parking && (
        <section className="map-layer-key">
          <strong>주차장 위치</strong>
          <p>
            {preview
              ? '서울·인접 지역의 등록 위치를 표시해요. 확대하면 개별 위치까지 보여요.'
              : '추천 장소별 직선 반경 800m 안의 위치만 표시해요. 확대하면 개별 위치까지 보여요.'}
          </p>
          <p>묶음 P 숫자는 위치 수 · 개별 P 숫자는 제공된 주차 가능 대수</p>
        </section>
      )}
      {layers.population && (
        <section className="map-layer-key">
          <strong>
            관측 인구 <small>혼잡도 히트맵</small>
          </strong>
          <div className="population-heat-key" aria-hidden="true" />
          <div className="map-color-key">
            {[
              ['#679dd5', '여유'],
              ['#dfbb58', '보통'],
              ['#e58b44', '약간 붐빔'],
              ['#cf5c70', '붐빔'],
            ].map(([color, label]) => (
              <span key={label}>
                <i style={{ background: color }} />
                {label}
              </span>
            ))}
          </div>
          <p>
            {preview ? '서울 관측 구역을 표시해요.' : '추천 장소별 반경 800m 주변만 표시해요.'} 색과
            수치는 해당 관측 구역 전체 기준입니다.
          </p>
          <p>2026.10.08 18:45 관측 · 구역을 누르면 원자료 확인</p>
        </section>
      )}
      {!Object.values(layers).some(Boolean) && (
        <p className="map-layer-hint">표시할 정보를 켜고, 지도 위에서 자세히 살펴보세요.</p>
      )}
      <p className="map-data-note">
        도로·인구는 보관된 관측값이며 현재 상태가 아닙니다. 추천 장소·이동시간은 모의 결과입니다.
      </p>
    </div>
  )
}

function Recommendations() {
  const { active, result, ui, patchUI, openDetail, search, retryRoute, excludeGeneral, openEdit } =
    useDemo()
  return (
    <section className="destination-list map-recommendations" aria-label="추천 장소 빠른 비교">
      {result && active.retainedResult?.id === result.id && !ui.busy && (
        <div className="retained-result-note" role="status">
          <Icon name="history" />
          <strong>이전 추천 유지</strong>
          <time>
            {new Date(result.time).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} 결과
          </time>
        </div>
      )}
      {result?.entries.length ? (
        <div className="compact-places">
          {result.entries.map((entry, index) => {
            const place = placeById(entry.id)
            if (!place) return null
            return (
              <button
                className={`compact-place ${active.selected === entry.id ? 'selected' : ''} ${ui.hover === entry.id ? 'is-place-preview' : ''}`}
                key={entry.id}
                data-id={entry.id}
                aria-label={`${place.name} 장소 보기`}
                aria-pressed={active.selected === entry.id}
                onClick={() => openDetail(entry.id)}
                onMouseEnter={() => patchUI({ hover: entry.id })}
                onMouseLeave={() => patchUI({ hover: null })}
                onFocus={() => patchUI({ hover: entry.id })}
                onBlur={() => patchUI({ hover: null })}
              >
                <span className="place-number">{index + 1}</span>
                <span className="compact-place-copy">
                  <strong>{place.name}</strong>
                  <span>
                    {place.category}{' '}
                    <span className="compact-place-time">
                      {entry.eta === null ? '이동시간 미확인' : `자동차 ${entry.eta}분`}
                    </span>
                  </span>
                </span>
                <Icon name="arrow" />
              </button>
            )
          })}
        </div>
      ) : ui.busy ? (
        <div className="compact-places is-preparing" aria-label="추천 장소 준비 중">
          {[1, 2, 3].map((n) => (
            <div className="place-skeleton" aria-hidden="true" key={n}>
              <span />
              <span />
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">
          <h3>조건에 맞는 장소가 없어요</h3>
          <p>이동시간이나 키워드를 바꿔보세요.</p>
          <button onClick={openEdit}>조건 직접 입력</button>
        </div>
      )}
      <div className="result-actions">
        <SaveTripButton />
        {result && !active.current ? (
          <>
            <button
              className="primary next-search"
              disabled={ui.busy}
              onClick={() => void retryRoute()}
            >
              이동시간 다시 확인
            </button>
            <button className="next-search" disabled={ui.busy} onClick={excludeGeneral}>
              다른 후보 찾기
            </button>
          </>
        ) : (
          <button
            className="next-search"
            disabled={ui.busy}
            onClick={() => void search(active.conditions)}
          >
            <Icon name="refresh" />
            {ui.busy ? '새로운 곳을 찾고 있어요' : '다른 곳도 추천해 주세요'}
          </button>
        )}
      </div>
    </section>
  )
}

export default function MapPanel({ preview = false }: { preview?: boolean }) {
  const [parkingHintRequested, setParkingHintRequested] = useState(false)
  const { active, result, ui, patchUI } = useDemo()
  const conditions = result?.conditions || ui.progress?.conditions || active.conditions
  return (
    <section className="map-panel" aria-label="추천 장소 지도">
      <div className="map-top">
        <div className="map-condition-chip" title={conditionText(conditions)}>
          <Icon name="pin" />
          <span className="condition-departure">{conditions.departure || '출발지 확인 중'}</span>
          <i aria-hidden="true" />
          <span className="condition-purpose">
            {conditions.purposes.join(' · ') || '추천 준비'}
          </span>
        </div>
        <details className="map-tools">
          <summary>
            <Icon name="map" />
            지도 정보
          </summary>
          <div className="map-tools-body">
            {!preview && (
              <>
                <strong>현재 조건</strong>
                <p className="map-applied-conditions">{conditionText(conditions)}</p>
              </>
            )}
            <MapLegend preview={preview} />
          </div>
        </details>
      </div>
      <div className={`map-stage real-map-stage ${ui.mapError ? 'has-map-error' : ''}`}>
        {ui.mapError ? (
          <div className="empty">
            <h3>지도를 불러오지 못했어요</h3>
            <p>추천 목록과 대화는 계속 사용할 수 있어요.</p>
            <button onClick={() => patchUI({ mapError: false })}>지도 다시 시도</button>
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="map-load-status" role="status">
                서울 지도를 준비하고 있어요…
              </div>
            }
          >
            <GeoMap
              key={`${active.trip}-${preview}`}
              preview={preview}
              parkingHintRequested={parkingHintRequested}
            />
          </Suspense>
        )}
        {preview && <LayerButtons onParkingClick={setParkingHintRequested} />}
        {!preview && (
          <>
            <div
              className="map-search-status"
              hidden={!ui.busy || !['search', 'route'].includes(ui.progress?.mode || '')}
            >
              <div className="map-search-heading">
                <span className="search-spinner" />
                <strong>추천 준비</strong>
                <span>모의 탐색</span>
              </div>
              <p>{ui.progress?.detail}</p>
            </div>
            <Recommendations />
          </>
        )}
      </div>
    </section>
  )
}
