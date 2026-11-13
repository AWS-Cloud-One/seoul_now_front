import { conditionText, dateLabel, placeById } from '../../lib/domain.js'
import { useAppState } from '../../state/useAppState'
import { focusMap, setMapOverlay, type Route } from '../../hooks/useRoute'
import { openDirectionsTo } from '../../state/directionsTarget'
import { SecondaryButton } from '../../components/common/ui'

/** Pre-chat saved bundles remain readable without reactivating the retired chat/API flow. */
export function ArchivedRecommendations({
  go,
  onShowMap,
}: {
  go: (route: Route) => void
  onShowMap?: () => void
}) {
  const { savedTrips, removeSavedTrip } = useAppState()
  if (!savedTrips.length) return null
  return (
    <details className="sn-section sn-archive">
      <summary>이전 추천 묶음 {savedTrips.length}개</summary>
      <p className="sn-note">저장 당시 자료예요. 최신 추천은 AI 추천에서 새로 받을 수 있어요.</p>
      {savedTrips.map((saved) => (
        <details key={saved.id} className="sn-section">
          <summary>{saved.title}</summary>
          <p className="sn-note">
            {dateLabel(saved.savedAt)} 저장 · {conditionText(saved.result.conditions)}
          </p>
          <ol className="sn-list">
            {saved.result.entries.map((entry, index) => {
              const place = placeById(entry.id, saved.result)
              if (!place) return null
              return (
                <li key={entry.id}>
                  <strong>
                    {index + 1}. {place.name}
                  </strong>
                  <p className="sn-note">{place.address}</p>
                  <div className="sn-actions">
                    <SecondaryButton
                      onClick={() => {
                        setMapOverlay({
                          destination: {
                            name: place.name,

                            lat: place.lat,
                            lng: place.lon,
                          },
                          route: null,
                          routeSegments: null,
                          recommendation: null,
                          food: null,
                        })
                        focusMap(place.lat, place.lon, 16)
                        onShowMap?.()
                      }}
                    >
                      지도에서 보기
                    </SecondaryButton>
                    <SecondaryButton
                      onClick={() => {
                        openDirectionsTo({
                          id: place.id,
                          name: place.name,
                          lat: place.lat,
                          lon: place.lon,
                          sub: place.address,
                        })
                        go('directions')
                      }}
                    >
                      여기로 길찾기
                    </SecondaryButton>
                  </div>
                </li>
              )
            })}
          </ol>
          <SecondaryButton onClick={() => removeSavedTrip(saved.id)}>
            이전 추천 저장 취소
          </SecondaryButton>
        </details>
      ))}
    </details>
  )
}
