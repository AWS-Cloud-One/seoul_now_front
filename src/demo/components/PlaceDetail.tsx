import { conditionText, dateLabel, placeById } from '../domain.js'
import { useDemo } from '../useDemo'
import Icon from './Icon'

export default function PlaceDetail() {
  const { active, result, ui, patchUI, showChat, exclude } = useDemo()
  const detail = ui.detail
  const place = placeById(detail?.id, result)
  const entry = result?.entries.find((e) => e.id === detail?.id)
  if (!detail || !place || !entry || !result || detail.resultId !== result.id) return null
  const number = result.entries.findIndex((e) => e.id === entry.id) + 1
  const unknown = entry.parkingUnknown || !place.parking?.length
  const nearest = unknown
    ? null
    : place.parking!.reduce((a, b) => (a.distance < b.distance ? a : b))
  const close = () => patchUI({ detail: null })
  const expand = (expanded: boolean) => patchUI({ detail: { ...detail, expanded } })
  if (!detail.expanded)
    return (
      <section className="place-detail is-summary" aria-labelledby="place-summary-title">
        <header className="place-summary-head">
          <span>
            <span className="place-number">{number}</span>
            {place.category} · 서울 {place.area}
            <small className="summary-demo">예시 장소</small>
          </span>
          <button className="place-summary-close" aria-label="장소 요약 닫기" onClick={close}>
            <Icon name="close" />
          </button>
        </header>
        <div className="place-summary-body">
          <div className="place-summary-title">
            <h2 id="place-summary-title">{place.name}</h2>
            <div className={`place-summary-eta ${entry.eta === null ? 'is-unknown' : ''}`}>
              <span>자동차 이동</span>
              <strong>
                {entry.eta === null ? (
                  '시간 미확인'
                ) : (
                  <>
                    {entry.eta}
                    <small>분</small>
                  </>
                )}
              </strong>
            </div>
          </div>
          <p className="place-summary-reason">{entry.reason}</p>
          <p className="place-summary-parking">
            <Icon name="parking" />
            <span>
              {unknown
                ? '주차 정보 미확인'
                : `가까운 주차장 직선 ${nearest!.distance}m · 빈자리 미확인`}
            </span>
          </p>
        </div>
        <footer className="place-summary-foot">
          <button onClick={showChat}>
            <Icon name="chat" />이 장소 질문
          </button>
          <button className="primary" onClick={() => expand(true)} aria-expanded={false}>
            자세히 보기 <Icon name="arrow" />
          </button>
        </footer>
      </section>
    )
  return (
    <section className="place-detail" aria-labelledby="place-detail-title">
      <header className="place-detail-head">
        <span>장소 상세 · 예시 정보</span>
        <div className="detail-head-actions">
          <button className="quiet small" onClick={() => expand(false)} aria-expanded={true}>
            요약으로 접기
          </button>
          <button className="place-summary-close" aria-label="장소 상세 닫기" onClick={close}>
            <Icon name="close" />
          </button>
        </div>
      </header>
      <div className="place-detail-body">
        <div className="place-detail-intro">
          <div className="place-detail-eyebrow">
            <span className="place-detail-number">{number}</span>
            <span>
              {place.category} · 서울 {place.area}
            </span>
            <span className="place-detail-demo">예시 장소</span>
          </div>
          <h2 id="place-detail-title">{place.name}</h2>
          <p className="place-detail-address">
            <Icon name="pin" />
            <span>{place.address}</span>
          </p>
        </div>
        <div className="place-detail-eta">
          <div className="place-detail-eta-label">
            <Icon name="car" />
            <span>자동차로 이동</span>
          </div>
          <strong>
            {entry.eta === null ? (
              <span className="place-detail-eta-unknown">확인 불가</span>
            ) : (
              <>
                {entry.eta}
                <span>분</span>
              </>
            )}
          </strong>
          <p>{dateLabel(entry.queryTime)} 조회 · 주차·도보 시간 제외</p>
        </div>
        <section
          className="place-detail-section place-detail-reason"
          aria-labelledby="place-detail-reason-title"
        >
          <h3 id="place-detail-reason-title">이곳을 추천하는 이유</h3>
          <p>{entry.reason}</p>
        </section>
        <section className="place-detail-section" aria-labelledby="place-detail-parking-title">
          <div className="place-detail-section-heading">
            <h3 id="place-detail-parking-title">주변 주차</h3>
            <span className="place-detail-parking-status">빈자리 미확인</span>
          </div>
          {unknown ? (
            <div className="place-detail-parking-record">
              <strong>주차장 정보를 확인하지 못했어요</strong>
              <p>주차장이 없다는 뜻은 아니에요.</p>
            </div>
          ) : (
            place.parking!.map((parking, i) => (
              <div className="place-detail-parking-record" key={`${parking.name}-${i}`}>
                <strong>{parking.name}</strong>
                <span className="place-detail-distance">직선 {parking.distance}m</span>
              </div>
            ))
          )}
          <p className="place-detail-note">표시된 거리는 직선거리이며, 실제 도보 거리와 달라요.</p>
        </section>
        <details className="place-detail-more">
          <summary>
            출처와 자세한 정보 <span aria-hidden="true">+</span>
          </summary>
          <div className="place-detail-more-content">
            <dl>
              <div>
                <dt>추천 당시 조건</dt>
                <dd>{conditionText(result.conditions)}</dd>
              </div>
              <div>
                <dt>장소·이동시간 출처</dt>
                <dd>
                  모의 장소 목록 · 모의 경로 응답
                  <br />
                  {dateLabel(entry.queryTime)} 조회 · {entry.sourceStatus}
                </dd>
              </div>
              <div>
                <dt>주차 탐색 범위</dt>
                <dd>
                  직선 반경{' '}
                  {place.parkingRadius === null
                    ? '미확인'
                    : unknown || place.parkingRadius === 1000
                      ? '1km'
                      : `${place.parkingRadius}m`}
                  {unknown ? '까지 조회 · 정보 확인 불가' : '에서 첫 결과 확인'}
                </dd>
              </div>
            </dl>
            {!unknown &&
              place.parking!.map((parking, index) => (
                <div className="place-detail-source" key={index}>
                  <strong>
                    {parking.name} · 직선 {parking.distance}m
                  </strong>
                  <p>
                    {parking.source}
                    <br />
                    측정 {dateLabel(parking.measured)} · 수집 {dateLabel(parking.collected)}
                  </p>
                </div>
              ))}
            <p className="place-detail-note">
              실시간 교통·영업 여부·주차 여유는 확인되지 않은 예시 정보예요.
            </p>
            <p className="place-detail-identifiers">
              ID {place.id}
              <br />
              위도 {place.lat.toFixed(6)} / 경도 {place.lon.toFixed(6)}
            </p>
            <button
              className="quiet danger small place-detail-exclude"
              onClick={() => exclude(place.id)}
              disabled={active.excluded.includes(place.id)}
            >
              {active.excluded.includes(place.id) ? '다음 탐색에서 제외돼요' : '이번 여행에서 제외'}
            </button>
          </div>
        </details>
      </div>
      <footer className="place-detail-foot">
        <button onClick={showChat}>
          <Icon name="chat" />이 장소 질문
        </button>
        <button
          className="primary"
          onClick={() => patchUI({ panel: { type: 'navigation', placeId: place.id } })}
        >
          <Icon name="car" />
          길안내
        </button>
      </footer>
    </section>
  )
}
