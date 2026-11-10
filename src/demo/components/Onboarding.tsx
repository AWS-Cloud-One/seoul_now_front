import { validateRecommendation } from '../recommendationConditions'
import RecommendationFeedback from './RecommendationFeedback'
import { useDemo } from '../useDemo'
import ConditionsForm from './ConditionsForm'
import Icon from './Icon'

export default function Onboarding() {
  const { active, ui, updateDraft, submitRecommendation } = useDemo()
  const draft = active.onboardingDraft || active.conditions
  const invalid = validateRecommendation(draft)
  return (
    <div className="dialog-inner onboarding">
      <header className="onboarding-head">
        <span className="welcome-eyebrow">새 여행</span>
        <h2 id="onboarding-title">오늘, 어디로 가볼까요?</h2>
        <p>
          출발지와 하고 싶은 일을 먼저 알려주세요.
          <br />
          추천을 받은 뒤에는 대화로 바꿀 수 있어요.
        </p>
      </header>
      <div className="onboarding-body">
        <RecommendationFeedback />
        <ConditionsForm
          initial={draft}
          mode="onboarding"
          onSubmit={(conditions) => void submitRecommendation(conditions, true)}
          onChange={updateDraft}
        />
      </div>
      <footer className="onboarding-foot">
        <p id="onboarding-readiness" aria-live="polite">
          {!draft.departure || !draft.purposes.length
            ? '출발지와 방문 목적을 선택해 주세요.'
            : invalid || '지금, 자동차로 출발하는 여행이에요.'}
        </p>
        <button
          className="primary"
          type="submit"
          form="onboarding-form"
          aria-describedby="onboarding-readiness"
          disabled={!!invalid || ui.busy}
        >
          이 조건으로 찾아보기 <Icon name="arrow" />
        </button>
      </footer>
    </div>
  )
}
