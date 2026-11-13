import { conditionText, dateLabel, placeById } from '../../lib/domain.js'
import { useSelectedParking } from '../../hooks/useSelectedParking'
import { useAppState } from '../../state/useAppState'
import { usePlaceInspection } from '../../hooks/usePlaceInspection'
import { useSecondsRemaining } from '../../hooks/useSecondsRemaining'
import type { Result } from '../../types/trip'
import InformationMeta from '../common/InformationMeta'
import Icon from '../common/Icon'
import { NearbyShopsSection, RouteSection } from './RouteSections'
import { FactRows, LoadingNote, PanelHeader, PrimaryButton, SecondaryButton } from '../common/ui'
import { sourceName } from '../../lib/sourceNames'
import { setMapOverlay, type Route } from '../../hooks/useRoute'

export default function ApiPlaceDetail({
  result,
  placeId,
  go,
}: {
  result: Result
  placeId: string
  go: (route: Route) => void
}) {
  const {
    active,
    ui,
    patchUI,
    exclude,
    askSelectedPlace,
    selectPlace,
    saveCurrentTrip,
    currentTripSaved,
  } = useAppState()
  const { detail, travel, contextError, loadDetail, loadTravel } = usePlaceInspection(
    result,
    active.api!,
    placeId,
  )
  const selectedParking = useSelectedParking(placeId)
  const detailWait = useSecondsRemaining(detail.failure?.retryAt)
  const travelWait = useSecondsRemaining(travel.failure?.retryAt)
  const apiWait = useSecondsRemaining(ui.apiFailure?.retryAt)
  const place = placeById(placeId, result)!
  const card = result.api!.result.cards.find((item) => item.place.value?.place_id === placeId)!
  const general = active.general?.id === result.id
  const blocked = !!contextError || ui.busy || !!ui.apiFailure?.canResend || apiWait > 0
  const facts = detail.data?.place || card.place
  const parking = detail.data?.parking
  const currentRoute = travel.data?.route
  const origin = result.api!.result.conditions.origin!
  const ask = (question: string) => {
    selectPlace(placeId)
    void askSelectedPlace(question)
    go('chat')
  }
  const providerUrl = facts.value?.provider_url
  const safeUrl = providerUrl && /^https?:\/\//i.test(providerUrl) ? providerUrl : null
  return (
    <div className="sn-detail">
      <PanelHeader
        title={place.name}
        back={{ label: '추천 목록', onClick: () => patchUI({ detail: null }) }}
        subtitle={`${place.category} · ${place.address}`}
      />
      <div className="sn-scroll">
        <div className="sn-action-row">
          <PrimaryButton
            onClick={() => {
              setMapOverlay({ parkingBase: null })
              go('parking')
            }}
          >
            <Icon name="parking" />
            {selectedParking ? '주차장 변경' : '주변 주차장'}
          </PrimaryButton>
          <SecondaryButton disabled={currentTripSaved} onClick={saveCurrentTrip}>
            <Icon name="bookmark" />
            {currentTripSaved ? '저장됨' : '저장'}
          </SecondaryButton>
        </div>
        <section className="sn-section" aria-label="선택한 주차장과 도보">
          <h3>주차 후 도보</h3>
          {selectedParking ? (
            <>
              <p>
                {selectedParking.lot.name} · 약 {selectedParking.minutes}분
              </p>
              <p className="sn-note">
                직선거리 기반 추정 · 주차장 외부 이용 가능 여부와 빈자리는 미확인
              </p>
            </>
          ) : (
            <p>주변 주차장에서 이용할 주차장을 선택해 주세요.</p>
          )}
        </section>
        {contextError && (
          <p className="sn-banner" role="status">
            {contextError}
          </p>
        )}
        <section className="sn-section" aria-label="저장된 결과">
          <h3>{general ? '후보를 찾았을 때의 정보' : '추천 당시 정보'}</h3>
          <p>{conditionText(result.conditions)}</p>
          <p className="sn-note">
            {general ? '후보 조회' : '추천 당시 조회'}: {dateLabel(result.time)}
          </p>
          <dl className="sn-facts" style={{ gridTemplateColumns: '1fr' }}>
            <div>
              <dt>당시 자동차 이동</dt>
              <dd>
                {card.route.status === 'available' && card.route.value
                  ? `약 ${Math.ceil(card.route.value.duration_seconds / 60)}분`
                  : '미확인'}
              </dd>
              <small>목적지까지 · 주차·도보 시간 제외</small>
            </div>
          </dl>
          <h3>당시 추천 근거</h3>
          <p>{card.reason.text || '확인된 추천 근거가 없어요.'}</p>
          <p className="sn-note">새 조회는 이 결과의 순위·이유·조회 시각을 바꾸지 않아요.</p>
        </section>
        <section className="sn-section" aria-label="장소 상세 조회">
          <h3>장소 정보와 등록 주차</h3>
          {detail.busy && <LoadingNote>상세 정보를 확인하고 있어요…</LoadingNote>}
          {detail.failure && <p role="alert">{detail.failure.message} 기존 정보는 유지해요.</p>}
          {detailWait > 0 && <p role="status">{detailWait}초 후 다시 조회할 수 있어요.</p>}
          <FactRows
            rows={[
              ['주소', facts.value?.road_address || facts.value?.address || '미확인'],
              ['전화', facts.value?.phone || '미확인'],
            ]}
          />
          {safeUrl && (
            <a className="sn-link" href={safeUrl} target="_blank" rel="noopener noreferrer">
              장소 제공처에서 보기 (새 창)
            </a>
          )}
          <InformationMeta information={facts} />
          {detail.data && (
            <p className="sn-meta">
              상세 확인 {dateLabel(detail.data.checked_at)} · 장소 기본 정보는 저장된 결과
              기준이에요.
            </p>
          )}
          {parking && (
            <>
              <h3>현재 조회한 등록 주차 정보</h3>
              <p className="sn-meta">
                조회 {dateLabel(parking.checked_at)} · 빈자리와 외부 이용 가능 여부는 미확인
              </p>
              {parking.status !== 'available' ? (
                <p>등록 주차 정보를 확인하지 못했어요. 주차장이 없다는 뜻은 아니에요.</p>
              ) : (
                <>
                  <FactRows
                    rows={[
                      [
                        '탐색 반경',
                        parking.search_radius_meters === null
                          ? '미확인'
                          : `${parking.search_radius_meters}m`,
                      ],
                      [
                        '등록 시설',
                        parking.total_count === null ? '미확인' : `${parking.total_count}곳`,
                      ],
                    ]}
                  />
                  {parking.items.length ? (
                    <details className="sn-more-rows">
                      <summary>등록 주차장 {parking.items.length}곳 보기</summary>
                      <FactRows
                        label="등록 주차장"
                        rows={parking.items.map((item) => {
                          const capacity = item.records
                            .map((record) => record.registered.value?.registered_capacity)
                            .find((value) => value !== null && value !== undefined)
                          return [
                            <>
                              {item.name}
                              <small className="sn-meta">
                                {' '}
                                · {item.records.map((r) => sourceName(r.source)).join(', ')}
                              </small>
                            </>,
                            `직선 ${Math.round(item.distance_meters)}m${capacity !== undefined ? ` · ${capacity}면` : ''}`,
                          ]
                        })}
                      />
                    </details>
                  ) : (
                    <p>이 탐색 범위에서 확인된 등록 주차장이 없어요.</p>
                  )}
                  {parking.next_cursor && (
                    <p className="sn-note">조회한 등록 시설 중 일부를 표시하고 있어요.</p>
                  )}
                </>
              )}
            </>
          )}
          <SecondaryButton
            disabled={
              blocked || detail.busy || detailWait > 0 || detail.failure?.retryable === false
            }
            onClick={() => void loadDetail()}
          >
            상세 다시 조회
          </SecondaryButton>
        </section>
        <section className="sn-section" aria-label="현재 이동시간 조회">
          <h3>현재 자동차 이동시간</h3>
          <p className="sn-note">
            이 결과의 원래 출발지인 {origin.label} 기준 · 주차·도보 시간 제외
          </p>
          {travel.data ? (
            <>
              <p>
                <strong>
                  {currentRoute?.status === 'available' && currentRoute.value
                    ? `약 ${Math.ceil(currentRoute.value.duration_seconds / 60)}분 · ${(currentRoute.value.distance_meters / 1000).toFixed(1)}km`
                    : '현재 이동시간 미확인'}
                </strong>
              </p>
              <p className="sn-note">현재 정보 조회: {dateLabel(travel.data.checked_at)}</p>
              <InformationMeta information={travel.data.route} />
            </>
          ) : (
            <p>아직 현재 이동시간을 조회하지 않았어요.</p>
          )}
          {travel.failure && (
            <p role="alert">
              {travel.failure.message}
              {travel.data && ' 마지막 조회값과 시각을 유지해요.'}
            </p>
          )}
          {travelWait > 0 && <p role="status">{travelWait}초 후 다시 조회할 수 있어요.</p>}
          <SecondaryButton
            disabled={
              blocked ||
              travel.busy ||
              travelWait > 0 ||
              (travel.failure?.retryable === false && !travel.failure.canResend)
            }
            onClick={() => void loadTravel()}
          >
            {travel.busy
              ? '이동시간 확인 중…'
              : travel.failure?.canResend
                ? '같은 이동시간 요청 다시 확인'
                : '현재 이동시간 조회'}
          </SecondaryButton>
        </section>
        <section className="sn-section" aria-label="장소 질문">
          <h3>이 장소에 질문하기</h3>
          {active.api?.clarification?.origin_context && (
            <p className="sn-note">진행 중인 출발지 확인을 먼저 마쳐 주세요.</p>
          )}
          <div className="stack">
            {[
              '왜 추천했어?',
              '지금 얼마나 걸려?',
              '주변 등록 주차 정보 알려줘',
              '주변 현재 인구 현황 알려줘',
            ].map((question) => (
              <SecondaryButton
                key={question}
                disabled={blocked || !!active.api?.clarification?.origin_context}
                onClick={() => ask(question)}
              >
                {question}
              </SecondaryButton>
            ))}
          </div>
        </section>
        <RouteSection
          key={place.id}
          place={place}
          origin={{
            id: 'result-origin',
            name: origin.label,
            lat: origin.coordinates.latitude,
            lon: origin.coordinates.longitude,
          }}
        />
        <NearbyShopsSection key={`food-${place.id}`} place={place} />
        <details className="sn-section sn-more">
          <summary>출처와 상세 정보</summary>
          <p>추천 당시 조건: {conditionText(result.conditions)}</p>
          <p>당시 장소 정보</p>
          <InformationMeta information={card.place} />
          <p>당시 이동시간</p>
          <InformationMeta information={card.route} />
          <SecondaryButton
            disabled={active.excluded.includes(place.id)}
            onClick={() => exclude(place.id)}
          >
            {active.excluded.includes(place.id) ? '다음 탐색에서 제외돼요' : '이번 여행에서 제외'}
          </SecondaryButton>
        </details>
      </div>
    </div>
  )
}
