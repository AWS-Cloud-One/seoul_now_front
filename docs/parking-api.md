# 주차장 API 연결

현재 실제 주차 API는 호출하지 않습니다. 미리보기는 기존 4개 임시 주차장(24·8·만차·42), 추천 후 지도는 기존 서울시 보관 자료를 사용합니다. 보관 자료에 없는 빈자리 수는 추정하지 않습니다.

## 교체 위치

- `src/demo/parking/source.ts`: 데이터 취득. 현재 `mockParkingSource`, 추후 `createParkingApiSource('/api/parking')`로 교체합니다.
- `src/demo/parking/normalize.ts`: 외부 응답 → 공통 `ParkingLot` 변환. 실제 공급자의 필드명이 다르면 여기 또는 source에서 매핑합니다.
- `src/demo/parking/store.ts`: 30초 간격 갱신, 요청 취소, 이전 응답 무시, 오류 시 마지막 정상 자료 보존.
- `src/demo/parking/useParkingData.ts`: UI 구독 및 수동 `refresh()`.
- `ConceptMap.tsx`, `GeoMap.tsx`, `MapRecord.tsx`: 동일 snapshot을 표시. 주차 갱신은 도로·인구 레이어나 열린 상세창을 닫지 않습니다.

`DemoProvider`의 `parkingSource` 속성에 **모듈 수준에서 생성한** source를 전달할 수 있습니다.

```tsx
const parkingSource = createParkingApiSource('/api/parking')
// 기존 Provider 위치에서 전달
<DemoProvider parkingSource={parkingSource}>{children}</DemoProvider>
```

현재 API source는 두 지도 scope(`preview`, `map`)에 같은 endpoint를 사용합니다. 범위별 요청/쿼리/인증이 필요하면 `ParkingSource.load(scope, signal)`를 구현하면 됩니다. 브라우저 코드에 비밀 API 키를 넣지 말고 서버 프록시를 사용하세요.

## 응답 계약

배열 또는 `{ "items": [...] }` 형태의 **전체 목록 snapshot**을 받습니다(부분 변경 응답 아님).

```json
{
  "items": [
    {
      "id": "parking-1",
      "name": "예시 주차장",
      "lat": 37.532,
      "lng": 126.97,
      "totalSpaces": 80,
      "availableSpaces": 24,
      "address": "서울특별시 ...",
      "updatedAt": "2026-11-02T10:00:00+09:00",
      "source": "public",
      "baseRate": { "amount": 500, "minutes": 10 },
      "hours": { "평일": ["00:00", "24:00"] }
    }
  ]
}
```

- `id`: 갱신 사이에도 유지되는 고유 ID. 없는 행은 제외하며 중복은 마지막 행을 사용합니다.
- 이름/주소/시간/요금/수치 누락은 미확인으로 처리합니다. 대수는 0 이상의 정수(숫자 문자열 허용). `availableSpaces: 0`은 만차, `null`은 미확인입니다. 총면수보다 큰 잔여면수도 미확인 처리합니다.
- 좌표 누락/범위 오류는 실제 지도 마커를 생략합니다. 미리보기는 기존 일러스트 지도에 좌표를 투영합니다. 고정 시안 위치가 필요하면 `previewPosition: {x,y}`(1600×900)를 전달합니다.
- 빈 배열은 정상적인 목록 삭제로 처리합니다. 잘못된 응답/HTTP 오류/전체 무효 행은 마지막 정상 자료를 유지하고 상세창에 갱신 실패를 안내합니다. 초기 실패는 빈 목록으로 안전하게 표시합니다.
- 개별 P 마커는 제공된 주차 가능 대수를 표시합니다. 기존 묶음 마커 숫자는 **주차장 위치 개수**이며 확대 후 개별 마커에서 잔여면수를 확인합니다. 미제공 잔여면수를 합산하거나 0으로 바꾸지 않습니다.
- 상세창은 선택한 ID로 최신 snapshot을 다시 조회하므로 이름·전체면수·잔여면수가 함께 갱신됩니다. 삭제된 주차장은 정보 없음으로 표시합니다.

검증: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
