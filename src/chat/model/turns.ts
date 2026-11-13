import type { ConversationSnapshot, PlaceReference, QuestionView } from '../api/types'
import type { Turn } from '../state/controller'

/**
 * The structured question of a turn. The conversation's `questions[]` wins because it carries
 * the currently issued choices; the run's own `question` is the record (possibly resolved).
 */
export function questionFor(turn: Turn, snapshot: ConversationSnapshot | null) {
  const runId = turn.run?.identity.run_id
  if (!runId) return null
  const current = snapshot?.questions?.find(
    (q) => q.source_run_id === runId && q.status === 'active',
  )
  if (current) return current
  const recorded = turn.run?.question
  if (!recorded) return null
  // The run copy may predate the answer: if the conversation no longer lists it, it is over.
  // (Only when the conversation is at least as new as the run copy, to avoid a flicker.)
  return recorded.status === 'active' &&
    snapshot &&
    snapshot.state_version >= (turn.run?.state_version ?? Infinity)
    ? { ...recorded, status: 'resolved' as const, options: [] }
    : recorded
}

export const activeQuestions = (snapshot: ConversationSnapshot | null) =>
  (snapshot?.questions ?? []).filter((q) => q.status === 'active')

/**
 * The question a plain composer message answers by default: only an active question asked by
 * the latest finished turn. Other open questions are answered explicitly from their own card.
 */
export function defaultReply(
  turns: Turn[],
  snapshot: ConversationSnapshot | null,
): { turnKey: string; question: QuestionView } | null {
  const last = [...turns].reverse().find((turn) => turn.phase !== 'rejected')
  if (!last || last.phase !== 'finished' || !last.run) return null
  const question = activeQuestions(snapshot).find(
    (q) => q.source_run_id === last.run!.identity.run_id,
  )
  return question ? { turnKey: last.key, question } : null
}

/** The stored reference of a recommendation card; never assembled from a string pattern. */
export function cardRef(
  refs: Record<string, PlaceReference>,
  resultId: string,
  rank: number | null,
): PlaceReference | null {
  if (rank === null) return null
  return (
    Object.values(refs).find((ref) => ref.result_id === resultId && ref.position === rank) ?? null
  )
}

export const placeName = (refs: Record<string, PlaceReference>, refId: string) =>
  refs[refId]?.place.name ?? null

/** 1-based order of recommendation results in this timeline ("2회차 추천"). */
export function resultOrdinals(turns: Turn[]) {
  const order = new Map<string, number>()
  for (const turn of turns) {
    const id = turn.run?.response?.recommendation?.result_id
    if (id && !order.has(id)) order.set(id, order.size + 1)
  }
  return order
}

export const isActive = (turn: Turn) =>
  turn.phase === 'sending' || turn.phase === 'unconfirmed' || turn.phase === 'tracking'
