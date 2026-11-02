import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import PlacePhoto from './PlacePhoto'
import { validPhotoUrl } from '../placePhotos'

afterEach(cleanup)
it('사진이 없거나 실패하면 예시 그림을 표시하고 다음 API URL로 복구한다', () => {
  const props = { name: '추천 장소', fallback: <span>카테고리 그림</span> }
  const view = render(<PlacePhoto {...props} />)
  expect(screen.getByText('카테고리 그림')).toBeInTheDocument()
  view.rerender(<PlacePhoto {...props} url="https://example.com/one.jpg" />)
  fireEvent.error(screen.getByRole('img', { name: '추천 장소 사진' }))
  expect(screen.getByText('카테고리 그림')).toBeInTheDocument()
  view.rerender(<PlacePhoto {...props} url="https://example.com/two.jpg" />)
  expect(screen.getByRole('img', { name: '추천 장소 사진' })).toHaveAttribute(
    'src',
    'https://example.com/two.jpg',
  )
  expect(validPhotoUrl('javascript:alert(1)')).toBeNull()
  expect(validPhotoUrl(123)).toBeNull()
  expect(validPhotoUrl('')).toBeNull()
})
