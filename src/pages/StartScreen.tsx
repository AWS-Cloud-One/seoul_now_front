import { useAppState } from '../state/useAppState'

const image = (path: string) => `${import.meta.env.BASE_URL}${path}`
export function StartScreen() {
  const { navigate } = useAppState()
  return (
    <section id="start-screen" className="start-screen" aria-labelledby="start-screen-title">
      <picture className="start-screen-photo" aria-hidden="true">
        <source media="(max-width:900px)" srcSet={image('images/seoul-portrait.png')} />
        <img src={image('images/seoul-wide.png')} alt="" fetchPriority="high" />
      </picture>
      <div className="start-screen-inner">
        <div className="start-screen-brand">밖과사전</div>
        <div className="start-screen-copy">
          <h1 id="start-screen-title">
            <img
              className="start-screen-wordmark"
              src={image('images/seoul-wordmark.svg')}
              alt="SEOUL"
              width="745"
              height="359"
            />
          </h1>
          <p>
            실시간 교통 및 주차 데이터를 바탕으로
            <br />
            가장 완벽한 동선의 서울 장소를 제안합니다.
          </p>
        </div>
        <div className="start-screen-bottom">
          <button
            type="button"
            id="start-screen-button"
            className="start-screen-button"
            onClick={() => navigate('preview')}
          >
            시작하기{' '}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="m9 4 8 8-8 8" />
            </svg>
          </button>
          <p className="start-screen-tagline">SEOUL, WHERE NEXT</p>
        </div>
      </div>
    </section>
  )
}
