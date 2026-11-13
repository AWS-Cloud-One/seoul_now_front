import { setOrigin, useOrigin } from '../../state/origin'
import Icon from '../common/Icon'
import { LoadingNote, SecondaryButton } from '../common/ui'
import OriginPicker from './OriginPicker'

/** Choose the shared departure: why it is needed, a detected nearby location, or a search. */
export default function OriginForm() {
  const origin = useOrigin()
  return (
    <div className="sn-origin-form">
      {origin.status === 'locating' && <LoadingNote>현재 위치를 확인하고 있어요…</LoadingNote>}
      {origin.location && (
        <p className="sn-origin-current">
          <Icon name="pin" />
          <span>
            지금 출발지 <strong>{origin.location.label}</strong>
            {origin.source === 'current' && <span className="sn-origin-tag">현재 위치</span>}
          </span>
        </p>
      )}
      {origin.message && <p className="sn-origin-message">{origin.message}</p>}
      {origin.detected && (
        <SecondaryButton
          className="is-compact"
          onClick={() => setOrigin(origin.detected!, 'current')}
        >
          <Icon name="locate" />
          현재 위치({origin.detected.label})에서 출발
        </SecondaryButton>
      )}
      <OriginPicker
        value={null}
        onChange={(location, source) => location && setOrigin(location, source)}
      />
    </div>
  )
}
