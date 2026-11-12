import type { AgeGroup, ApiConditions, ConditionsPatch, GroupType, Purpose } from '../api/contracts'
import type { Conditions } from '../types/trip'

export const purposeCodes: Record<string, Purpose> = {
  카페: 'cafe',
  식사: 'food',
  산책: 'walk',
  전시: 'exhibition',
}
const groupCodes: Record<string, GroupType> = {
  혼자: 'solo',
  연인: 'date',
  친구: 'friends',
  가족: 'family',
  기타: 'other',
}
const ageCodes: Record<string, AgeGroup> = {
  '10세 미만': 'under_10',
  '10대': 'teens',
  '20대': 'twenties',
  '30대': 'thirties',
  '40대': 'forties',
  '50대': 'fifties',
  '60대 이상': 'sixty_plus',
}
export function validateRecommendation(c: Conditions): string | null {
  if (!c.origin || c.origin.label !== c.departure) return '검색 결과에서 출발지를 선택해 주세요.'
  if (!c.origin.supported) return '출발지는 서울·인천·경기 지역만 지원해요.'
  if (
    !Number.isFinite(c.origin.coordinates.latitude) ||
    !Number.isFinite(c.origin.coordinates.longitude)
  )
    return '출발지 좌표를 다시 확인해 주세요.'
  if (!c.purposes.length || c.purposes.length > 2 || c.purposes.some((p) => !purposeCodes[p]))
    return '방문 목적을 1~2개 선택해 주세요.'
  if (c.headcount !== null && (!Number.isSafeInteger(c.headcount) || c.headcount < 1))
    return '방문 인원은 1명 이상의 정확한 정수로 입력해 주세요.'
  if (
    c.maxMinutes !== null &&
    (!Number.isFinite(c.maxMinutes) ||
      Math.round(c.maxMinutes * 60) < 1 ||
      !Number.isSafeInteger(Math.round(c.maxMinutes * 60)))
  )
    return '최대 이동시간은 0보다 큰 숫자로 입력해 주세요.'
  return null
}
/** Full form values, diffed against authoritative conditions; null explicitly clears optional fields. */
export function recommendationPatch(c: Conditions, current?: ApiConditions): ConditionsPatch {
  const error = validateRecommendation(c)
  if (error) throw new Error(error)
  const value: ApiConditions = {
    origin: structuredClone(c.origin!),
    purposes: c.purposes.map((label) => ({
      purpose: purposeCodes[label],
      keyword: c.purposeKeywords?.[purposeCodes[label]]?.trim() || null,
    })),
    group_type: c.group ? groupCodes[c.group] : null,
    age_groups: c.ages.length ? c.ages.map((age) => ageCodes[age]) : null,
    headcount: c.headcount,
    max_travel_seconds: c.maxMinutes === null ? null : Math.round(c.maxMinutes * 60),
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, next]) =>
        !current || JSON.stringify(next) !== JSON.stringify(current[key as keyof ApiConditions]),
    ),
  ) as ConditionsPatch
}
