import { useId } from 'react'
import Icon from '../../components/common/Icon'
import InformationMeta from '../../components/common/InformationMeta'
import { PrimaryButton, SecondaryButton } from '../../components/common/ui'
import { Modal } from '../../components/workspace/Dialog'
import { setMapOverlay } from '../../hooks/useRoute'
import type { ContextCard } from '../api/types'
import { kilometers, minutes, parkingText, routeText } from '../model/labels'
import { directionsTo } from './actions'
import '../place-details.css'

/** Details of this exact recommendation snapshot, without a V1 result token or model call. */
export function PlaceDetails({
  card,
  onClose,
  onShowMap,
}: {
  card: ContextCard
  onClose: () => void
  onShowMap: () => void
}) {
  const id = useId()
  const place = card.place.value
  if (!place) return null
  const url =
    place.provider_url && /^https?:\/\//i.test(place.provider_url) ? place.provider_url : null
  const phone = place.phone?.replace(/[\s()-]/g, '')
  const call = phone && /^\+?\d+$/.test(phone) ? `tel:${phone}` : null
  const route = card.route.status === 'available' ? card.route.value : null
  const parking = card.parking
  const count = parking.status === 'available' ? parking.total_count : null
  const parkingMeta = [
    parking.search_radius_meters !== null &&
      `반경 ${kilometers(parking.search_radius_meters)} 기준`,
    count !== null &&
      count > 0 &&
      parking.nearest_distance_meters !== null &&
      `가장 가까운 곳 ${kilometers(parking.nearest_distance_meters)}`,
  ]
    .filter(Boolean)
    .join(' · ')
  const traffic = card.reason.evidence.filter((item) => item.type === 'traffic')
  const navigate = (action: () => void) => {
    onClose()
    action()
  }
  return (
    <Modal className="dialog sn-place-dialog" id={id} labelledBy={`${id}-title`} onClose={onClose}>
      <div className="dialog-inner sn-place-details">
        <header className="dialog-head sn-place-heading">
          <div>
            <p className="sn-place-category">
              {place.category_name?.split(' > ').at(-1) || '장소 상세'}
            </p>
            <h2 id={`${id}-title`}>{place.name}</h2>
          </div>
          <button
            type="button"
            className="quiet close-btn"
            aria-label="상세 닫기"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="dialog-body sn-place-details-body">
          <section aria-label="장소 정보" className="sn-place-contact">
            <div className="sn-place-address">
              <Icon name="pin" />
              <div>
                <span>주소</span>
                <p>{place.road_address || place.address || '주소를 확인하지 못했어요'}</p>
              </div>
            </div>
            <dl className="sn-place-contact-rows">
              <div>
                <dt>전화</dt>
                <dd>
                  {call ? <a href={call}>{place.phone}</a> : place.phone || '등록된 전화번호 없음'}
                </dd>
              </div>
              {url && (
                <div>
                  <dt>더 알아보기</dt>
                  <dd>
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      장소 페이지 <Icon name="arrow" />
                      <span className="sr-only">새 창에서 열기</span>
                    </a>
                  </dd>
                </div>
              )}
            </dl>
          </section>
          <section aria-labelledby={`${id}-visit`} className="sn-place-visit">
            <h3 id={`${id}-visit`}>방문할 때</h3>
            <div className="sn-place-visit-row">
              <Icon name="car" />
              <div>
                <span className="sn-place-label">자동차 이동</span>
                <p className={route ? 'sn-place-value' : 'sn-place-unavailable'}>
                  {route
                    ? `약 ${minutes(route.duration_seconds)}`
                    : card.route.reason_code === 'ORIGIN_NOT_SET'
                      ? '출발지 설정 후 확인'
                      : routeText(card.route)}
                </p>
                {route && (
                  <p className="sn-place-caption">주행거리 {kilometers(route.distance_meters)}</p>
                )}
              </div>
            </div>
            <div className="sn-place-visit-row">
              <Icon name="parking" />
              <div>
                <span className="sn-place-label">주변 주차</span>
                <p className={count !== null ? 'sn-place-value' : 'sn-place-unavailable'}>
                  {count !== null ? (
                    <>
                      등록 주차장 <strong>{count}곳</strong>
                    </>
                  ) : (
                    parkingText(parking)
                  )}
                </p>
                {parkingMeta && <p className="sn-place-caption">{parkingMeta}</p>}
                <button
                  type="button"
                  className="sn-place-parking-link"
                  onClick={() =>
                    navigate(() => {
                      setMapOverlay({
                        parkingBase: {
                          name: place.name,
                          lat: place.coordinates.latitude,
                          lng: place.coordinates.longitude,
                        },
                      })
                      window.location.hash = '/parking'
                    })
                  }
                >
                  주변 주차장 보기 <Icon name="chevronRight" />
                </button>
              </div>
            </div>
          </section>
          {(card.reason.source === 'ai' || traffic.length > 0) && (
            <details className="sn-place-evidence">
              <summary>선정 정보</summary>
              {card.reason.source === 'ai' && <p>{card.reason.text}</p>}
              {traffic.map((item, i) => (
                <p key={i}>{item.text}</p>
              ))}
            </details>
          )}
          <InformationMeta information={card.place} />
        </div>
        <footer className="dialog-foot sn-place-footer">
          <SecondaryButton onClick={() => navigate(onShowMap)}>
            <Icon name="pin" /> 지도에서 보기
          </SecondaryButton>
          <PrimaryButton onClick={() => navigate(() => directionsTo(place))}>
            <Icon name="map" /> 여기로 길찾기
          </PrimaryButton>
        </footer>
      </div>
    </Modal>
  )
}
