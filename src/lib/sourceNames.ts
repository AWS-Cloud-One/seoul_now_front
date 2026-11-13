// Display names for data sources reported by the API (unknown codes are shown as is).
const sources: Record<string, string> = {
  kakao: '카카오',
  kakao_local: '카카오 장소',
  kakao_mobility: '카카오모빌리티',
  seoul_city_population: '서울 실시간 인구',
  seoul_citydata: '서울 실시간 도시데이터',
  topis_traffic: '서울 교통정보(TOPIS)',
  national_parking: '전국 주차장 표준데이터',
}
export const sourceName = (source: string | null): string =>
  source ? sources[source] || source : '출처 미확인'
