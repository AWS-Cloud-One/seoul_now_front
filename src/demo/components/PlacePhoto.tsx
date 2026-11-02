import { useState } from 'react'
import type { ReactNode } from 'react'

import { validPhotoUrl } from '../placePhotos'
export default function PlacePhoto({
  url,
  name,
  fallback,
}: {
  url?: string | null
  name: string
  fallback: ReactNode
}) {
  const source = validPhotoUrl(url)
  const [failed, setFailed] = useState<string | null>(null)
  return (
    <span className="place-photo">
      {source && source !== failed ? (
        <img
          key={source}
          src={source}
          alt={`${name} 사진`}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(source)}
        />
      ) : (
        <span className="place-photo-fallback" aria-label="카테고리별 예시 그림">
          {fallback}
          <span className="place-photo-caption">예시 이미지</span>
        </span>
      )}
    </span>
  )
}
