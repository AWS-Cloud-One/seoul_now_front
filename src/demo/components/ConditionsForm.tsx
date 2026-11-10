import { useState } from 'react'
import { conditionChanges, EMPTY_CONDITIONS, PURPOSES } from '../domain.js'
import { useDemo } from '../useDemo'
import type { Conditions } from '../types'
import Icon from './Icon'
import RecommendationOrigin from './RecommendationOrigin'
import { useSecondsRemaining } from '../useSecondsRemaining'
import { purposeCodes, validateRecommendation } from '../recommendationConditions'

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
  const [draft, setDraft] = useState<Conditions>(() => ({
    ...structuredClone(initial),
    keyword: null,
  }))
  const [error, setError] = useState('')
  const retryWait = useSecondsRemaining(ui.apiFailure?.retryAt)
  const blocked = ui.busy || !!ui.apiFailure?.canResend || retryWait > 0
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
  const keyword = draft.purposes.map((purpose) => (
    <div className="field" key={purpose}>
      <label htmlFor={`${mode}-keyword-${purposeCodes[purpose]}`}>
        {purpose} 키워드 <small className="form-label-note">선택</small>
      </label>
      <input
        id={`${mode}-keyword-${purposeCodes[purpose]}`}
        value={draft.purposeKeywords?.[purposeCodes[purpose]] || ''}
        maxLength={100}
        placeholder={`${purpose}에서 찾고 싶은 것`}
        onChange={(e) =>
          update({
            purposeKeywords: {
              ...draft.purposeKeywords,
              [purposeCodes[purpose]]: e.target.value || null,
            },
          })
        }
      />
    </div>
  ))
  const invalid = validateRecommendation(draft)
  return (
    <>
      <form
        id={`${mode}-form`}
        className="stack condition-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          if (blocked) return
          if (invalid) {
            setError(invalid)
            return
          }
          onSubmit(structuredClone(draft))
        }}
      >
        <fieldset className="stack" disabled={ui.busy}>
          <RecommendationOrigin
            value={draft.origin?.label === draft.departure ? draft.origin : null}
            disabled={ui.busy}
            onChange={(origin) => update({ origin, departure: origin?.label || null })}
          />
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
                  <input
                    id={`${mode}-headcount`}
                    type="number"
                    name="headcount"
                    min={1}
                    step={1}
                    value={draft.headcount ?? ''}
                    placeholder="예: 4"
                    onChange={(e) =>
                      update({ headcount: e.target.value === '' ? null : Number(e.target.value) })
                    }
                  />
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
                  step="any"
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
                    origin: draft.origin,
                    purposeKeywords: {},
                    purposes: draft.purposes,
                  })
                  notify('선택 조건을 비웠어요. 적용하기 전에는 현재 조건이 바뀌지 않아요.')
                }}
              >
                선택 조건 모두 지우기
              </button>
            </div>
          </details>
        </fieldset>
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
            <button className="primary" type="submit" disabled={blocked}>
              이 조건으로 {mode === 'edit' ? '다시 추천' : '찾아보기'} <Icon name="arrow" />
            </button>
          </>
        )}
      </form>
    </>
  )
}
