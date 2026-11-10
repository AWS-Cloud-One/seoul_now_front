import InformationMeta from './InformationMeta'
import ParkingRegistration from './ParkingRegistration'
import type { MapRecord as RecordData, ParkingRecord } from '../mapLayers'
import { dateLabel } from '../domain.js'
import type { ReactNode } from 'react'

const sources: Record<string, string> = {
  public: '서울시 공영주차장 안내',
  city: '서울 도시데이터 · 주차 기본정보',
  standard: '전국주차장정보표준데이터',
}
const kinds: Record<string, string> = {
  '02': '도시고속도로',
  '03': '주간선도로',
  '04': '보조간선도로',
  '05': '기타도로',
}
const number = (n: number | null | undefined) => (n == null ? '미확인' : n.toLocaleString('ko-KR'))
function Shell({
  kind,
  title,
  children,
  foot,
}: {
  kind: string
  title: string
  children: ReactNode
  foot: ReactNode
}) {
  return (
    <article className="map-record">
      <header>
        <span>{kind}</span>
        <span className="map-record-snapshot">관측·등록 자료</span>
      </header>
      <h3>{title}</h3>
      {children}
      <footer>{foot}</footer>
    </article>
  )
}
export default function MapRecord({
  record,
  onSelectParking,
  parkingError,
}: {
  parkingError?: string | null
  record: RecordData
  onSelectParking: (record: RecordData) => void
}) {
  if (record.kind === 'origin')
    return (
      <Shell kind="내 위치" title={record.data.name} foot="예시 위치">
        <p className="map-record-note">
          선택한 출발지에 표시한 예시 위치예요. 실제 기기 위치는 사용하지 않았어요.
        </p>
      </Shell>
    )
  if (record.kind === 'road') {
    const road = record.data
    return (
      <Shell
        kind="도로 교통량"
        title={road.name || '도로명 미확인'}
        foot={
          <>
            서울 TOPIS{road.receivedAt ? ` · ${dateLabel(road.receivedAt)} 수신` : ''}
            <br />
            원천 측정 시각 {road.measurementTime ? dateLabel(road.measurementTime) : '미제공'}
          </>
        }
      >
        {(road.classes.length > 0 || road.direction) && (
          <p className="map-record-sub">
            {[...road.classes.map((c) => kinds[c]), road.direction].filter(Boolean).join(' · ')}
          </p>
        )}
        <div className="map-record-metric">
          <span>{road.live ? '관측 통행속도' : '저장 당시 통행속도'}</span>
          <strong>
            {road.speed === null ? '미확인' : number(road.speed)}
            {road.speed !== null && <small>km/h</small>}
          </strong>
        </div>
        {road.travelSeconds != null && (
          <dl>
            <div>
              <dt>구간 통과시간</dt>
              <dd>{number(road.travelSeconds)}초</dd>
            </div>
          </dl>
        )}
        {road.information && <InformationMeta information={road.information} />}
        {!road.live && <p className="map-record-note">저장된 교통 관측 자료예요.</p>}
      </Shell>
    )
  }
  if (record.kind === 'population') {
    const population = record.data.properties
    return (
      <Shell
        kind="관측 인구"
        title={population.name}
        foot={
          <>
            {record.data.live ? '서울 실시간 도시데이터' : '서울 도시데이터 · 저장 자료'}
            <br />
            {population.observedAt
              ? `${dateLabel(population.observedAt)} 관측`
              : '관측 시각 미확인'}
          </>
        }
      >
        {record.data.information && <InformationMeta information={record.data.information} />}
        <span className="population-status">{population.congestion || '미확인'}</span>
        <div className="map-record-metric population-metric">
          <span>관측 구역 내 추정 인구</span>
          <strong>
            {population.min == null && population.max == null ? (
              '인원 정보 없음'
            ) : (
              <>
                {population.min != null &&
                population.max != null &&
                population.min !== population.max
                  ? `${number(population.min)}–${number(population.max)}`
                  : number(population.min ?? population.max)}
                <small>명</small>
              </>
            )}
          </strong>
        </div>
        <p className="map-record-note">
          {record.data.live
            ? '관측 구역 전체의 추정 인구예요.'
            : '관측 구역 전체의 보관 관측값이며 추천 순위에는 반영하지 않아요.'}
        </p>
      </Shell>
    )
  }
  if (record.kind === 'parking-cluster')
    return (
      <Shell
        kind="주차장"
        title={`가까운 주차장 위치 ${record.data.length}건`}
        foot="등록 위치가 가까워 함께 표시했어요."
      >
        {record.data.map(({ location, record: parking }) => (
          <button
            className="nearby-parking-record"
            key={parking.id}
            onClick={() =>
              onSelectParking({
                kind: 'parking',
                data: {
                  ...location,
                  records: [parking, ...location.records.filter((r) => r.id !== parking.id)],
                },
              })
            }
          >
            <strong>{parking.name}</strong>
            <span>{parking.address || '주소 미확인'}</span>
          </button>
        ))}
      </Shell>
    )
  const parking: ParkingRecord | undefined = record.data.records[0]
  if (!parking)
    return (
      <Shell kind="주차장" title="주차장 정보 없음" foot="최신 자료에 해당 주차장이 없습니다.">
        <p className="map-record-note">다른 주차장을 선택해 주세요.</p>
      </Shell>
    )
  if (parking.api) return <ParkingRegistration key={parking.id} lot={parking} />
  const fee =
    parking.baseRate && parking.baseRate.amount != null && parking.baseRate.minutes
      ? `${number(parking.baseRate.minutes)}분 ${number(parking.baseRate.amount)}원`
      : parking.feeStatus || '미확인'
  return (
    <Shell
      kind="주차장"
      title={parking.name}
      foot={
        <>
          {parking.available === null && (
            <span className="map-record-availability-note">
              실시간 빈자리 정보가 제공되지 않아요.
            </span>
          )}
          {sources[parking.source || ''] || parking.source || '출처 미제공'}
          <br />
          {parking.collectedAt ? dateLabel(parking.collectedAt) : '시각 미제공'} 수집 ·
          요금·운영정보 변동 가능
        </>
      }
    >
      <p className="map-record-sub">{parking.address || '주소 미확인'}</p>
      {parking.available !== null && (
        <div className={`parking-availability ${parking.available === 0 ? 'is-full' : ''}`}>
          {parking.available === 0 ? '만차' : `잔여 ${number(parking.available)}면`}
        </div>
      )}
      <dl>
        <div>
          <dt>구분</dt>
          <dd>{parking.kind || '미확인'}</dd>
        </div>
        <div>
          <dt>전체 주차면</dt>
          <dd>{parking.capacity === null ? '미확인' : `${number(parking.capacity)}면`}</dd>
        </div>
        <div>
          <dt>기본요금</dt>
          <dd>{fee}</dd>
        </div>
        {Object.entries(parking.hours || {})
          .filter(([, hours]) => hours.length === 2 && hours.every(Boolean))
          .map(([day, hours]) => (
            <div key={day}>
              <dt>{day}</dt>
              <dd>{hours.join('–')}</dd>
            </div>
          ))}
      </dl>
      {parkingError && (
        <p className="map-record-note">정보를 갱신하지 못해 마지막 정상 자료를 표시합니다.</p>
      )}
      {record.data.records.length > 1 && (
        <details className="parking-source-records">
          <summary>같은 위치의 등록자료 {record.data.records.length}건</summary>
          {record.data.records.map((r) => (
            <p key={r.id}>
              {r.name}
              <small>{sources[r.source || ''] || r.source || '출처 미제공'}</small>
            </p>
          ))}
        </details>
      )}
    </Shell>
  )
}
