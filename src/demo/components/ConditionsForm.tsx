import { useState } from 'react'
import {
  conditionChanges,
  DEPARTURES,
  EMPTY_CONDITIONS,
  MockService,
  PURPOSES,
  validateConditions,
} from '../domain.js'
import { useDemo } from '../useDemo'
import type { Conditions } from '../types'
import Icon from './Icon'

export default function ConditionsForm({
  initial,
  mode = 'edit',
  onSubmit,
  onChange,
}: {
  initial: Conditions
  mode?: string
  onSubmit: (conditions: Conditions) => void
  onChange?: (conditions: Conditions) => void
}) {
  const { active, ui, notify } = useDemo()
  const [draft, setDraft] = useState(() => structuredClone(initial))
  const [error, setError] = useState('')
  const [location, setLocation] = useState(false)
  const [locating, setLocating] = useState(false)
  const onboarding = mode === 'onboarding'
  function update(patch: Partial<Conditions>) {
    const next = { ...draft, ...patch }
    setDraft(next)
    setError('')
    onChange?.(next)
  }
  function toggle(field: 'purposes' | 'ages', value: string) {
    if (field === 'purposes' && draft.purposes.length === 2 && !draft.purposes.includes(value)) {
      notify('목적은 최대 두 개까지 선택할 수 있어요.')
      return
    }
    update({
      [field]: draft[field].includes(value)
        ? draft[field].filter((v) => v !== value)
        : [...draft[field], value],
    })
  }
  async function locate(mode: string) {
    setLocating(true)
    const response = await MockService.locate(mode)
    if (response.departure) {
      update({ departure: response.departure })
      notify(`예시 위치를 ${response.departure}으로 설정했어요. 실제 위치는 사용하지 않았습니다.`)
    } else notify(response.error!)
    setLocating(false)
    setLocation(false)
  }
  const keyword = (
    <div className="field">
      <label htmlFor={`${mode}-keyword`}>
        떠오르는 키워드 <small className="form-label-note">선택</small>
      </label>
      <input
        id={`${mode}-keyword`}
        name="keyword"
        value={draft.keyword || ''}
        maxLength={40}
        placeholder="예: 커피, 책, 정원"
        onChange={(e) => update({ keyword: e.target.value || null })}
      />
    </div>
  )
  const invalid = validateConditions(draft)
  return (
    <>
      <form
        id={`${mode}-form`}
        className="stack condition-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          if (invalid) {
            setError(invalid)
            return
          }
          onSubmit(structuredClone(draft))
        }}
      >
        <div className="field">
          <label htmlFor={`${mode}-departure`}>
            어디에서 출발하세요?{' '}
            <small className="form-label-note">{onboarding ? '필수' : '지금, 자동차로'}</small>
          </label>
          <div className="departure-row">
            <select
              id={`${mode}-departure`}
              name="departure"
              value={draft.departure || ''}
              required
              onChange={(e) => update({ departure: e.target.value || null })}
            >
              <option value="">출발지를 선택해 주세요</option>
              {Object.entries(DEPARTURES).map(([name, value]) => (
                <option key={name} value={name}>
                  {value.region} · {name}
                </option>
              ))}
            </select>
            {ui.page !== 'preview' && (
              <button type="button" onClick={() => setLocation(!location)}>
                <Icon name="locate" />
                현재 위치
              </button>
            )}
          </div>
        </div>
        <fieldset className="field">
          <legend>
            오늘은 무엇을 하고 싶나요?{' '}
            <span className="form-label-note">{onboarding ? '필수 · ' : ''}최대 2개</span>
          </legend>
          <div className="choice-row">
            {PURPOSES.map((purpose) => (
              <label className="choice" key={purpose}>
                <input
                  type="checkbox"
                  name="purposes"
                  value={purpose}
                  checked={draft.purposes.includes(purpose)}
                  onChange={() => toggle('purposes', purpose)}
                />
                <span>{purpose}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {!onboarding && keyword}
        <details className="optional" open={undefined}>
          <summary>
            {onboarding ? '추가 조건' : '조금 더 맞춰볼까요?'}{' '}
            <span className="form-label-note">선택</span>
          </summary>
          <div className="stack">
            {onboarding && keyword}
            <div className="form-grid">
              <div className="field">
                <label htmlFor={`${mode}-group`}>함께 가는 사람</label>
                <select
                  id={`${mode}-group`}
                  name="group"
                  value={draft.group || ''}
                  onChange={(e) => update({ group: e.target.value || null })}
                >
                  <option value="">선택 안 함</option>
                  {['혼자', '연인', '친구', '가족', '기타'].map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </div>
              <div className="field visit-count-select">
                <label htmlFor={`${mode}-headcount`}>방문 인원</label>
                <select
                  id={`${mode}-headcount`}
                  name="headcount"
                  value={
                    draft.headcount == null
                      ? ''
                      : draft.headcount >= 5
                        ? 5
                        : draft.headcount >= 3
                          ? 3
                          : draft.headcount
                  }
                  onChange={(e) =>
                    update({ headcount: e.target.value ? Number(e.target.value) : null })
                  }
                >
                  <option value="">선택 안 함</option>
                  {[
                    [1, '1명'],
                    [2, '2명'],
                    [3, '3~4명'],
                    [5, '5명 이상'],
                  ].map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <fieldset className="field">
              <legend>
                연령대 <span className="form-label-note">여러 개 선택 가능</span>
              </legend>
              <div className="choice-row">
                {['10세 미만', '10대', '20대', '30대', '40대', '50대', '60대 이상'].map((age) => (
                  <label className="choice age" key={age}>
                    <input
                      type="checkbox"
                      name="ages"
                      value={age}
                      checked={draft.ages.includes(age)}
                      onChange={() => toggle('ages', age)}
                    />
                    <span>{age}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="field">
              <label htmlFor={`${mode}-maxMinutes`}>
                최대 자동차 이동시간 <small className="form-label-note">분</small>
              </label>
              <input
                id={`${mode}-maxMinutes`}
                type="number"
                name="maxMinutes"
                min={1}
                step={1}
                value={draft.maxMinutes ?? ''}
                placeholder="비워두면 시간 제한 없어요"
                onChange={(e) =>
                  update({ maxMinutes: e.target.value === '' ? null : Number(e.target.value) })
                }
              />
              <span className="micro muted">
                주차장을 찾는 시간과 내린 뒤 걷는 시간은 포함하지 않아요.
              </span>
            </div>
            <button
              type="button"
              className="quiet small"
              onClick={() => {
                update({
                  ...EMPTY_CONDITIONS,
                  departure: draft.departure,
                  purposes: draft.purposes,
                })
                notify('선택 조건을 비웠어요. 적용하기 전에는 현재 조건이 바뀌지 않아요.')
              }}
            >
              선택 조건 모두 지우기
            </button>
          </div>
        </details>
        <p className="form-error" id={`${mode}-error`} role="alert">
          {error}
        </p>
        {!onboarding && (
          <>
            <div className="change-summary">
              {mode === 'edit' && (
                <>
                  <strong>변경 전 → 적용할 조건</strong>
                  {conditionChanges(active.conditions, draft).map((change) => (
                    <p key={change}>{change}</p>
                  ))}
                </>
              )}
            </div>
            <button className="primary" type="submit" disabled={ui.busy}>
              이 조건으로 {mode === 'edit' ? '다시 추천' : '찾아보기'} <Icon name="arrow" />
            </button>
          </>
        )}
      </form>
      {location && (
        <section className="notice info" aria-label="현재 위치 시뮬레이션">
          <h3>현재 위치 시뮬레이션</h3>
          <p>실제 위치 권한을 요청하거나 좌표를 수집하지 않아요.</p>
          <div className="stack">
            {[
              ['gangnam', '강남역 위치로 시연'],
              ['success', '서울역 위치로 시연'],
              ['denied', '위치 권한 거부 재현'],
              ['outside', '지원 지역 밖 재현'],
            ].map(([value, label]) => (
              <button
                type="button"
                key={value}
                disabled={locating}
                onClick={() => void locate(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  )
}
