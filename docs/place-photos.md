# 장소 사진 연결

추천 응답의 `Entry.photoUrl` 또는 장소 기본 정보의 `Place.photoUrl`에 사진 URL을 전달하면 카드가 자동으로 사진을 표시합니다. 추천 응답의 사진이 우선이고, 없으면 장소 기본 정보를 사용합니다. 데이터는 장소 ID와 함께 매핑하세요.

```ts
const entry: Entry = {
  ...existingEntry,
  photoUrl: apiRow.image_url ?? null, // 실제 API 필드에 맞게 매핑
}
```

`PlacePhoto.tsx`가 HTTP(S) URL과 사이트 내 상대 경로를 표시합니다. URL 누락·잘못된 형식·이미지 로딩 실패는 카테고리별 예시 그림으로 대체합니다. 이후 새 URL이 들어오면 다시 사진을 시도합니다. 현재 실제 사진 API 요청은 추가하지 않았습니다. 사진은 일러스트와 같은 영역에 `object-fit: cover`로 표시됩니다.
