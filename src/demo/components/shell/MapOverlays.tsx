import { useSelectedParking } from '../../parking/useSelectedParking'
import { useEffect, useState } from 'react'
import { DEPARTURES, dateLabel, placeById } from '../../domain.js'
import { useDemo } from '../../useDemo'
import { useLayout } from './layout'
import Icon from '../Icon'
import { fitMap, getMapOverlay, MAP_OVERLAY_EVENT } from './useRoute'
import { useLive } from '../../live/store'
import { POPULATION_HEAT_COLORS } from '../../live/populationHeat'
import { ROAD_SPEED_COLORS } from '../../live/roadStyle'
import { ROUTE_ROAD_COLORS } from '../../routing/roadTraffic'
import { IconButton, PrimaryButton, SecondaryButton, StatusBadge } from './ui'

const layerOptions = [
  ['parking', '주차장', 'parking'],
  ['population', '유동인구수', 'people'],
  ['roads', '도로혼잡도', 'car'],
] as const

function useRouting() {
  const [routing, setRouting] = useState(() => !!getMapOverlay().route?.length)
  useEffect(() => {
    const update = () => setRouting(!!getMapOverlay().route?.length)
    window.addEventListener(MAP_OVERLAY_EVENT, update)
    return () => window.removeEventListener(MAP_OVERLAY_EVENT, update)
  }, [])
  return routing
}

export function LayerMenu() {
  const { layers, toggleLayer } = useDemo()
  const live = useLive()
  const routing = useRouting()
  return (
    <div className="sn-map-layers">
      <div className="sn-layer-buttons" role="group" aria-label="지도 표시 항목">
        {layerOptions.map(([key, label, icon]) => (
          <button
            key={key}
            type="button"
            className={'sn-layer-toggle is-' + key}
            aria-label={label + ' 표시'}
            aria-pressed={layers[key] && !(key === 'roads' && routing)}
            disabled={key === 'roads' && routing}
            title={
              key === 'roads' && routing
                ? '길찾기 중에는 경로선의 교통 상태만 표시해요'
                : label + ' 켜기 / 끄기'
            }
            onClick={() => toggleLayer(key)}
          >
            <Icon name={icon} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      {layers.population &&
        !live.places.some((place) => !place.stale) &&
        live.savedPlaces.length > 0 && (
          <p className="sn-population-status" role="status">
            현재 유효한 인구 관측을 확인하지 못했어요. 구역 위치만 표시해요.
          </p>
        )}
      {layers.population && live.status === 'error' && !live.savedPlaces.length && (
        <p className="sn-population-status" role="status">
          유동인구 데이터를 불러오지 못했어요.
        </p>
      )}
      {layers.population && live.status === 'loading' && !live.places.length && (
        <p className="sn-population-status" role="status">
          유동인구를 불러오는 중이에요…
        </p>
      )}
    </div>
  )
}

function useLegend() {
  const { layers } = useDemo()
  const routing = useRouting()
  // Parking has no colour scale to explain, so it does not appear in the legend.
  return { layers, routing, any: layers.population || layers.roads || routing }
}

function LegendGroups() {
  const { layers, routing } = useLegend()
  return (
    <>
      {layers.population && (
        <section className="sn-lg" aria-label="관측 인구 혼잡">
          <h4>관측 인구 혼잡</h4>
          <div
            className="sn-lg-gradient"
            role="img"
            aria-label="여유에서 혼잡까지"
            style={{
              background: `linear-gradient(90deg, ${POPULATION_HEAT_COLORS.여유}, ${POPULATION_HEAT_COLORS.보통} 38%, ${POPULATION_HEAT_COLORS['약간 붐빔']} 68%, ${POPULATION_HEAT_COLORS.붐빔})`,
            }}
          />
          <div className="sn-lg-ends" aria-hidden="true">
            <span>여유</span>
            <span>혼잡</span>
          </div>
        </section>
      )}
      {(layers.roads || routing) && (
        <section className="sn-lg" aria-label="도로 소통">
          <h4>{routing ? '경로 위 도로 관측' : '도로 소통'} (km/h)</h4>
          <ul className="sn-lg-dots">
            {(routing ? ROUTE_ROAD_COLORS : ROAD_SPEED_COLORS).map(({ color, label }) => (
              <li key={label}>
                <i style={{ background: color }} />
                {label}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

/** Spread-out legend along the bottom-left when the map has room; a small clickable bar otherwise. */
export function MapLegend() {
  const { legendOpen } = useLayout()
  const { any } = useLegend()
  const [expanded, setExpanded] = useState(false)
  if (!any) return null
  if (legendOpen)
    return (
      <div className="sn-legend-bar" role="group" aria-label="지도 색상 안내">
        <LegendGroups />
      </div>
    )
  return (
    <div className="sn-legend-mini">
      {expanded && (
        <div
          className="sn-glass sn-legend-panel"
          id="sn-legend-panel"
          role="group"
          aria-label="지도 색상 안내"
        >
          <IconButton
            className="sn-pop-close"
            icon="close"
            label="범례 닫기"
            onClick={() => setExpanded(false)}
          />
          <LegendGroups />
        </div>
      )}
      <button
        type="button"
        className="sn-glass sn-legend-toggle"
        aria-expanded={expanded}
        aria-controls="sn-legend-panel"
        aria-label="지도 색상 안내 펼치기"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="sn-legend-tile" aria-hidden="true">
          <Icon name="layers" />
        </span>
        <span className="sn-legend-label">범례도</span>
        <Icon name={expanded ? 'chevronDown' : 'chevronUp'} />
      </button>
    </div>
  )
}

export function SelectionSummary({
  onDetail,
  onParking,
  variant = 'map',
}: {
  onDetail: () => void
  onParking: () => void
  /** 'map' floats bottom-right over the map; 'panel' sits inside the left panel when it is wide. */
  variant?: 'map' | 'panel'
}) {
  const { wide } = useLayout()
  const { active, result, ui, selectPlace } = useDemo()
  const parking = useSelectedParking(active.selected)
  const place = placeById(active.selected, result)
  const entry = result?.entries.find((e) => e.id === active.selected)
  if (!place || !entry || !result || ui.detail) return null
  // Never both at once: the map card when the panel is narrow, the panel block when it is wide.
  if (variant === 'map' ? wide : !wide) return null
  const number = result.entries.indexOf(entry) + 1
  const conditions = result.conditions
  const coordinates = conditions.origin?.coordinates
  const origin = coordinates
    ? { lat: coordinates.latitude, lon: coordinates.longitude }
    : conditions.departure
      ? DEPARTURES[conditions.departure]
      : undefined
  return (
    <section
      className={variant === 'map' ? 'sn-glass sn-summary-card' : 'sn-selected-inline'}
      aria-label="선택한 장소 요약"
    >
      <span className="sn-rank" aria-hidden="true">
        {number}
      </span>
      <div className="sn-summary-main">
        <strong>{place.name}</strong>
        <span>
          {place.category} ·{' '}
          {entry.eta === null ? '이동시간 확인 불가' : `목적지까지 자동차 ${entry.eta}분`}
        </span>
        <span>
          <StatusBadge>
            {parking
              ? `${parking.lot.name} · 도보 약 ${parking.minutes}분(추정)`
              : '주차장 선택 필요'}
          </StatusBadge>
          <small>추천 계산 {dateLabel(entry.queryTime)}</small>
        </span>
      </div>
      <div className="sn-summary-actions">
        <PrimaryButton className="is-compact" onClick={onDetail}>
          상세 보기
        </PrimaryButton>
        {origin && (
          <SecondaryButton
            className="is-compact"
            onClick={() =>
              fitMap([
                [origin.lat, origin.lon],
                [place.lat, place.lon],
              ])
            }
          >
            출발지와 함께
          </SecondaryButton>
        )}
        <SecondaryButton className="is-compact" onClick={onParking}>
          주변 주차장
        </SecondaryButton>
      </div>
      <IconButton
        className="sn-summary-close"
        icon="close"
        label="선택 해제"
        onClick={() => selectPlace('')}
      />
    </section>
  )
}
