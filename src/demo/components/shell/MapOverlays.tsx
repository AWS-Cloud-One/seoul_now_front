import { useEffect, useRef, useState } from 'react'
import { DEPARTURES, dateLabel, placeById } from '../../domain.js'
import { useDemo } from '../../useDemo'
import { useLayout } from './layout'
import Icon from '../Icon'
import { fitMap } from './useRoute'
import { IconButton, PrimaryButton, SecondaryButton, StatusBadge } from './ui'

const layerOptions = [
  ['parking', '주차장', 'parking'],
  ['population', '관측 인구', 'people'],
  ['roads', '도로 교통량', 'car'],
] as const

export function LayerMenu() {
  const { layers, toggleLayer } = useDemo()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        root.current?.querySelector<HTMLButtonElement>('.sn-layer-trigger')?.focus()
      }
    }
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', key)
    document.addEventListener('pointerdown', away)
    return () => {
      document.removeEventListener('keydown', key)
      document.removeEventListener('pointerdown', away)
    }
  }, [open])
  return (
    <div className="sn-layer-menu" ref={root}>
      <button
        type="button"
        className="sn-glass sn-layer-trigger"
        aria-expanded={open}
        aria-controls="sn-layer-pop"
        onClick={() => setOpen(!open)}
      >
        <Icon name="layers" />
        지도 정보
      </button>
      {open && (
        <div
          className="sn-glass sn-layer-pop"
          id="sn-layer-pop"
          role="group"
          aria-label="지도 정보"
        >
          <IconButton
            className="sn-pop-close"
            icon="close"
            label="지도 정보 닫기"
            onClick={() => setOpen(false)}
          />
          {layerOptions.map(([key, label, icon]) => (
            <label key={key} className="sn-check">
              <input type="checkbox" checked={layers[key]} onChange={() => toggleLayer(key)} />
              <Icon name={icon} />
              {label}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function useLegend() {
  const { layers } = useDemo()
  // Parking has no colour scale to explain, so it does not appear in the legend.
  return { layers, any: layers.population || layers.roads }
}

function LegendGroups() {
  const { layers } = useLegend()
  return (
    <>
      {layers.population && (
        <section className="sn-lg" aria-label="관측 인구 혼잡">
          <h4>관측 인구 혼잡</h4>
          <div className="sn-lg-gradient" role="img" aria-label="여유에서 혼잡까지" />
          <div className="sn-lg-ends" aria-hidden="true">
            <span>여유</span>
            <span>혼잡</span>
          </div>
        </section>
      )}
      {layers.roads && (
        <section className="sn-lg" aria-label="도로 소통">
          <h4>도로 소통</h4>
          <ul className="sn-lg-dots">
            {[
              ['#1f9d6b', '원활'],
              ['#e0a21b', '서행'],
              ['#d4443b', '정체'],
            ].map(([color, label]) => (
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
  const place = placeById(active.selected)
  const entry = result?.entries.find((e) => e.id === active.selected)
  if (!place || !entry || !result || ui.detail) return null
  // Never both at once: the map card when the panel is narrow, the panel block when it is wide.
  if (variant === 'map' ? wide : !wide) return null
  const number = result.entries.indexOf(entry) + 1
  const origin = active.conditions.departure ? DEPARTURES[active.conditions.departure] : undefined
  const unknown = entry.parkingUnknown || !place.parking?.length
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
            {unknown
              ? '주차 정보 없음'
              : `주차장→목적지 도보 약 ${Math.max(1, Math.round((Math.min(...place.parking!.map((p) => p.distance)) * 1.3) / 67))}분(추정)`}
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
