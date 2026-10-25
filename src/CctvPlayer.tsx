import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'

export default function CctvPlayer({
  url,
  name,
  onClose,
}: {
  url: string
  name: string
  onClose: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [message, setMessage] = useState('영상을 불러오는 중입니다.')
  useEffect(() => {
    const element = video.current!
    let hls: Hls | null = null
    if (element.canPlayType('application/vnd.apple.mpegurl')) element.src = url
    else if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: false,
        manifestLoadingMaxRetry: 1,
        levelLoadingMaxRetry: 1,
        fragLoadingMaxRetry: 1,
      })
      hls.loadSource(url)
      hls.attachMedia(element)
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          setMessage(
            '영상을 재생할 수 없습니다. 주소 만료·제공처 연결·브라우저 허용 상태를 확인해 주세요.',
          )
          hls?.destroy()
        }
      })
    } else element.src = url
    return () => {
      hls?.destroy()
      element.pause()
      element.removeAttribute('src')
      element.load()
    }
  }, [url])
  return (
    <section className="card">
      <strong>{name}</strong>
      <button onClick={onClose}>영상 닫기</button>
      <video
        ref={video}
        controls
        autoPlay
        muted
        playsInline
        style={{ width: '100%', maxHeight: 420 }}
        onPlaying={() =>
          setMessage(
            '이 브라우저에서 재생 중입니다. 원본 촬영 시각과 영상 지연은 별도 확인이 필요합니다.',
          )
        }
        onError={() =>
          setMessage('영상 재생에 실패했습니다. 제공된 주소를 직접 열어볼 수 있습니다.')
        }
      />
      <p role="status">{message}</p>
    </section>
  )
}
