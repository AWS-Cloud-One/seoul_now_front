import { conditionText, dateLabel, placeById } from '../../lib/domain.js'
import { useAppState } from '../../state/useAppState'
import Icon from '../common/Icon'

export default function SavedTrips() {
  const {
    savedTrips,
    result,
    currentTripSaved,
    ui,
    closePanel,
    saveCurrentTrip,
    openSavedTrip,
    removeSavedTrip,
  } = useAppState()
  return (
    <div className="dialog-inner saved-trips-content">
      <header className="dialog-head saved-trips-head">
        <div>
          <span className="saved-trips-eyebrow">MY TRIPS</span>
          <h2 id="panel-title">
            저장한 여행 <span>{savedTrips.length}</span>
          </h2>
          <p>마음에 든 추천을 모아두고, 언제든 다시 펼쳐보세요.</p>
        </div>
        <button className="quiet close-btn" aria-label="저장한 여행 닫기" onClick={closePanel}>
          <Icon name="close" />
        </button>
      </header>
      <div className="saved-trips-toolbar">
        <span>이 브라우저에 보관돼요</span>
        <button
          type="button"
          className="saved-trips-save-current"
          disabled={!result?.entries.length || currentTripSaved}
          onClick={saveCurrentTrip}
        >
          <Icon name="bookmark" />
          {currentTripSaved ? '현재 추천 저장됨' : '현재 추천 저장'}
        </button>
      </div>
      <div className="saved-trips-scroll">
        {savedTrips.length ? (
          <ul className="saved-trips-list">
            {savedTrips.map((saved) => (
              <li className="saved-trip-item" key={saved.id}>
                <button
                  type="button"
                  className="saved-trip-open"
                  aria-label={`${saved.title} 저장한 여행 열기`}
                  onClick={() => openSavedTrip(saved.id)}
                >
                  <span className="saved-trip-symbol" aria-hidden="true">
                    <Icon name="bookmark" />
                  </span>
                  <span className="saved-trip-copy">
                    <strong>{saved.title}</strong>
                    <span className="saved-trip-conditions">
                      {conditionText(saved.result.conditions)}
                    </span>
                    <span className="saved-trip-places">
                      {saved.result.entries.map((entry, index) => (
                        <span key={entry.id}>
                          <b>{index + 1}</b>
                          {placeById(entry.id, saved.result)?.name}
                        </span>
                      ))}
                    </span>
                    <time dateTime={saved.savedAt}>
                      {dateLabel(saved.savedAt)} 저장 · {saved.result.entries.length}곳
                    </time>
                  </span>
                  <span className="saved-trip-arrow" aria-hidden="true">
                    <Icon name="arrow" />
                  </span>
                </button>
                <div className="saved-trip-bottom">
                  <span>저장한 추천 그대로 다시 보기</span>
                  <button
                    type="button"
                    className="quiet"
                    aria-label={`${saved.title} 저장 해제`}
                    onClick={() => removeSavedTrip(saved.id)}
                  >
                    저장 해제
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="saved-trips-empty">
            <span aria-hidden="true">
              <Icon name="bookmark" />
            </span>
            <h3>아직 저장한 여행이 없어요</h3>
            <p>
              장소를 추천받은 뒤 <strong>여행 저장</strong>을 눌러보세요.
              <br />
              저장한 여행을 누르면 당시 추천 장소가 다시 표시돼요.
            </p>
          </div>
        )}
      </div>
      <footer className="saved-trips-foot">
        <p role="status">{ui.toast || '저장한 여행의 장소와 조회 시각은 저장 당시 기준이에요.'}</p>
      </footer>
    </div>
  )
}
