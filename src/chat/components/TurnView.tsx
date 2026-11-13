import { useState } from 'react'
import Icon from '../../components/common/Icon'
import { LoadingNote, SecondaryButton, StatusBadge } from '../../components/common/ui'
import type { ChatResponse, ContinuationResult, ExecutionView } from '../api/types'
import {
  STATUS_BADGE,
  clock,
  fieldLabel,
  isRetryTask,
  responseTitle,
  retryLabel,
  stageLabel,
  warningTexts,
} from '../model/labels'
import { defaultReply, questionFor, resultOrdinals } from '../model/turns'
import type { Turn } from '../state/controller'
import { useChatController, useChatState } from '../state/useChat'
import { ComparisonView, LookupResult } from './LookupResult'
import { PreparedOutcome, RecommendationResult } from './RecommendationResult'
import { QuestionPanel } from './QuestionPanel'

function RunProgress({ turn, run }: { turn: Turn; run: ExecutionView }) {
  const stages = [
    ...new Set(
      turn.events.flatMap((event) =>
        event.type === 'stage_started' && typeof event.payload.stage === 'string'
          ? [event.payload.stage]
          : [],
      ),
    ),
  ]
  const current =
    run.status === 'accepted'
      ? stageLabel('accepted')
      : run.status === 'reconciling'
        ? '반영 여부를 확인하는 중'
        : stageLabel(run.stage)
  return (
    <div className="sn-chat-progress">
      <div className="sn-chat-thinking" role="status">
        <span className="sn-chat-thinking-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span key={current} className="sn-chat-stage">
          {current}
        </span>
      </div>
      {stages.length > 1 && (
        <details className="sn-chat-progress-detail">
          <summary>진행 단계</summary>
          <ol className="sn-chat-steps" aria-label="처리 단계">
            {stages.map((stage, i) => (
              <li key={stage} className={i === stages.length - 1 ? 'is-current' : 'is-done'}>
                {i < stages.length - 1 && <Icon name="check" />}
                {stageLabel(stage)}
              </li>
            ))}
          </ol>
        </details>
      )}
      {run.response?.answer && <p className="sn-chat-sub">{run.response.answer}</p>}
      {run.cancel_requested_at && (
        <p className="sn-chat-sub" role="status">
          중단을 요청했어요. 서버의 실제 결과를 기다리고 있어요.
        </p>
      )}
    </div>
  )
}

function CommitNote({ turn, response }: { turn: Turn; response: ChatResponse }) {
  const controller = useChatController()
  const commit = response.snapshot?.finalization.commit
  if (!commit && response.status !== 'reconciling') return null
  if (commit?.state === 'committed') {
    const fields = commit.receipt.changed_fields
    return fields.length ? (
      <p className="sn-chat-commit">
        <Icon name="check" /> 반영됨 · {fields.map(fieldLabel).join(', ')}
      </p>
    ) : null
  }
  if (commit?.state === 'not_applied')
    return <p className="sn-chat-commit is-muted">조건 변경은 반영하지 않았어요.</p>
  return (
    <div className="sn-chat-commit is-warn" role="status">
      <p>실제 반영 여부를 확인하고 있어요. 같은 변경을 다시 보내지 않아요.</p>
      <SecondaryButton className="is-compact" onClick={() => controller.recheck(turn.key)}>
        <Icon name="refresh" />
        반영 여부 다시 확인
      </SecondaryButton>
    </div>
  )
}

const CONTINUATION: Record<ContinuationResult['status'], string | null> = {
  pending: null,
  completed: null,
  failed: '추천은 완료됐고, 이어서 요청한 조회는 완료하지 못했어요.',
  interrupted: '추천은 완료됐고, 이어서 요청한 조회는 중간에 멈췄어요.',
  blocked: '추천은 완료됐지만 이어서 요청한 조회는 진행하지 못했어요.',
  cancelled: '추천은 유지되고, 이어서 요청한 조회는 중단했어요.',
  waiting_input: '이어서 조회하려면 답이 필요해요.',
}

function Continuation({ value, onShowMap }: { value: ContinuationResult; onShowMap?: () => void }) {
  const note = CONTINUATION[value.status]
  return (
    <section className="sn-chat-continuation" aria-label="이어서 조회">
      <strong>이어서 조회</strong>
      {value.status === 'pending' && <LoadingNote>이어서 조회하는 중이에요…</LoadingNote>}
      {note && <p className="sn-chat-sub">{note}</p>}
      {value.lookup && <LookupResult lookup={value.lookup} onShowMap={onShowMap} />}
    </section>
  )
}

function ResponseView({
  turn,
  run,
  response,
  ordinal,
  isDefaultReply,
  onShowMap,
}: {
  turn: Turn
  run: ExecutionView
  response: ChatResponse
  ordinal: number
  isDefaultReply: boolean
  onShowMap?: () => void
}) {
  const controller = useChatController()
  const state = useChatState()
  const question = questionFor(turn, state.snapshot)
  const badge =
    response.status === 'waiting_input' && question?.status === 'resolved'
      ? null
      : STATUS_BADGE[response.status]
  const title = responseTitle(response)
  const warnings = warningTexts(response.warnings)
  const tasks = run.status === 'finished' ? run.retryable_tasks.filter(isRetryTask) : []
  const canRetry = state.boot === 'ready' && !controller.busy && !state.busyAction
  return (
    <div className="sn-bubble sn-chat-answer">
      <span className="sn-chat-author">밖과사전</span>
      {(badge || title) && (
        <div className="sn-chat-badges">
          {title && <StatusBadge tone={title[1]}>{title[0]}</StatusBadge>}
          {badge && !title && <StatusBadge tone={badge[1]}>{badge[0]}</StatusBadge>}
          {response.evaluation?.branch === 'alternative' && (
            <StatusBadge tone="info">허용한 대안 조건 적용</StatusBadge>
          )}
        </div>
      )}
      {response.recommendation ? (
        <p className="sn-chat-intro">
          {response.recommendation.search_area?.label ?? '서울'}에서 조건에 맞는 장소{' '}
          {response.recommendation.cards.length}곳을 찾았어요.
        </p>
      ) : response.lookup?.items.length ? (
        <p className="sn-chat-intro">
          {response.lookup.outcome === 'error'
            ? '정보를 불러오지 못했어요.'
            : response.lookup.outcome === 'unavailable'
              ? '확인할 자료가 없어요.'
              : response.lookup.outcome === 'empty'
                ? '확인한 범위에 결과가 없어요.'
                : response.lookup.outcome === 'partial'
                  ? '확인된 정보부터 보여드릴게요.'
                  : response.lookup.items.some((item) => item.topic === 'parking')
                    ? '주변 주차장을 확인했어요.'
                    : '요청한 정보를 정리했어요.'}
        </p>
      ) : (
        <div className="sn-chat-prose">
          {response.answer
            .split(/\n+/)
            .filter(Boolean)
            .map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
        </div>
      )}
      {warnings.map((warning) => (
        <p key={warning} className="sn-chat-sub">
          {warning}
        </p>
      ))}
      <CommitNote turn={turn} response={response} />
      {response.recommendation ? (
        <RecommendationResult
          recommendation={response.recommendation}
          ordinal={ordinal}
          onShowMap={onShowMap}
        />
      ) : (
        response.kind === 'result' && <PreparedOutcome snapshot={response.snapshot} />
      )}
      {response.lookup && <LookupResult lookup={response.lookup} onShowMap={onShowMap} />}
      {response.comparison && <ComparisonView comparison={response.comparison} />}
      {response.continuation && (
        <Continuation value={response.continuation} onShowMap={onShowMap} />
      )}
      <QuestionPanel question={question} response={response} isDefaultReply={isDefaultReply} />
      {tasks.length > 0 && (
        <div className="sn-chat-retry">
          {tasks.map((task) => (
            <SecondaryButton
              key={task}
              className="is-compact"
              disabled={!canRetry}
              onClick={() => void controller.retry(turn.key, task)}
            >
              <Icon name="refresh" />
              {retryLabel(task)}
            </SecondaryButton>
          ))}
        </div>
      )}
    </div>
  )
}

function UserLine({ turn }: { turn: Turn }) {
  if (turn.source === 'external')
    return <p className="sn-chat-system">다른 화면에서 보낸 요청이에요.</p>
  if (turn.input === 'retry')
    return (
      <p className="sn-chat-system">
        <Icon name="refresh" /> {turn.label ?? '다시 시도'}
      </p>
    )
  return (
    <div
      className={`sn-bubble is-user ${turn.input === 'action' ? 'is-choice' : ''} ${turn.phase === 'rejected' ? 'is-rejected' : ''}`}
    >
      {turn.input === 'action' && <small className="sn-chat-target">선택지</small>}
      {turn.label && turn.input !== 'action' && (
        <small className="sn-chat-target">{turn.label}</small>
      )}
      <p>{turn.text}</p>
    </div>
  )
}

export function TurnView({ turn, onShowMap }: { turn: Turn; onShowMap?: () => void }) {
  const controller = useChatController()
  const state = useChatState()
  const [animateArrival] = useState(() => turn.phase !== 'finished')
  const run = turn.run
  const response = run?.response
  const ordinals = resultOrdinals(state.turns)
  const reply = defaultReply(state.turns, state.snapshot)
  const runId = run?.identity.run_id
  const at = turn.events.length ? turn.events[turn.events.length - 1].created_at : turn.createdAt
  return (
    <div
      className="sn-chat-turn"
      data-phase={turn.phase}
      data-run={runId}
      data-arriving={animateArrival && turn.phase === 'finished'}
    >
      <UserLine turn={turn} />
      {turn.phase === 'sending' && <LoadingNote>보내는 중…</LoadingNote>}
      {turn.phase === 'unconfirmed' && (
        <div className="sn-chat-problem" role="alert">
          <p>{turn.problem?.message}</p>
          <SecondaryButton className="is-compact" onClick={() => controller.confirm(turn.key)}>
            <Icon name="refresh" />
            같은 요청으로 확인
          </SecondaryButton>
        </div>
      )}
      {turn.phase === 'rejected' && (
        <p className="sn-chat-problem" role="alert">
          {turn.problem?.message}
        </p>
      )}
      {run && turn.phase === 'tracking' && <RunProgress turn={turn} run={run} />}
      {run && response && turn.phase === 'finished' && (
        <ResponseView
          turn={turn}
          run={run}
          response={response}
          ordinal={ordinals.get(response.recommendation?.result_id ?? '') ?? 0}
          isDefaultReply={reply?.turnKey === turn.key}
          onShowMap={onShowMap}
        />
      )}
      {run && turn.phase === 'finished' && !response && (
        <p className="sn-chat-problem">결과 내용을 받지 못했어요.</p>
      )}
      {turn.problem &&
        (turn.problem.kind === 'poll' ||
          turn.problem.kind === 'cancel' ||
          turn.problem.kind === 'not_found') && (
          <p className="sn-chat-sub" role="status">
            {turn.problem.message}
          </p>
        )}
      {turn.phase === 'finished' && at && (
        <time className="sn-chat-time" dateTime={at}>
          {clock(at)}
        </time>
      )}
    </div>
  )
}
