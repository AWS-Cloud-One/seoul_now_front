import { createContext, useEffect, useRef, useState } from 'react'
import { loadSavedTrips, persistSavedTrips } from './savedTrips'
import { apiClient, ApiTransportError } from '../api/client'
import type { ChatTarget, ConditionsPatch, ConversationData, OriginAction } from '../api/contracts'
import { originChoices, originContextUnavailable, recentChatMessages } from './chatContext'
import { RequestManager } from '../api/requestManager'
import type { RequestAttempt } from '../api/requestManager'
import { recommendationPatch, validateRecommendation } from './recommendationConditions'
import {
  applyConversationResponse,
  createServerTrip,
  displayConditions,
  normalizeResult,
  resultContextStatus,
} from './apiState'
import {
  conditionChanges,
  conditionsEqual,
  conditionText,
  MockService,
  newState,
  normalizeTrip,
  validSavedTrip,
  validateConditions,
} from './domain.js'
import type {
  Conditions,
  Layers,
  MapView,
  Message,
  Notice,
  Panel,
  Progress,
  Response,
  Result,
  SavedTrip,
  Store,
  Trip,
} from './types'

type ChatOptions = { originAction?: OriginAction; target?: ChatTarget }
type LastApiCommand =
  | { kind: 'recommendation'; tripId: string; patch: ConditionsPatch }
  | { kind: 'chat'; tripId: string; text: string; options: ChatOptions }
  | { kind: 'retry-routes'; tripId: string; resultId: string }

const STORAGE_KEY = 'seoul-next-stop-trips-v2'
const defaultLayers: Layers = { roads: true, parking: true, population: true }
function loadStore(): Store {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null')
    if (saved?.schema === 2 && Array.isArray(saved.trips)) {
      const trips: Trip[] = saved.trips
        .filter(validSavedTrip)
        .map(normalizeTrip)
        .map((trip: Trip) => ({
          ...trip,
          groups: trip.groups.map(normalizeResult),
          general: trip.general ? normalizeResult(trip.general) : null,
        }))
      if (trips.length)
        return {
          schema: 2,
          trips,
          activeTripId: trips.some((t) => t.trip === saved.activeTripId)
            ? saved.activeTripId
            : trips[0].trip,
        }
    }
    const legacy = JSON.parse(sessionStorage.getItem('seoul-next-stop-v1') || 'null')
    if (validSavedTrip(legacy)) {
      const trip = normalizeTrip(legacy)
      return { schema: 2, trips: [trip], activeTripId: trip.trip }
    }
  } catch {
    /* Private browsing and corrupt storage fall back to a new trip. */
  }
  const trip = newState()
  return { schema: 2, trips: [trip], activeTripId: trip.trip }
}
function initialPage() {
  if (new URLSearchParams(window.location.search).get('view') === 'map') return 'preview'
  try {
    return sessionStorage.getItem('seoul-start-screen-entered') === '1'
      ? sessionStorage.getItem('seoul-entry-page') === 'main'
        ? 'main'
        : 'preview'
      : 'start'
  } catch {
    return 'start'
  }
}
const initialUI = () => ({
  page: initialPage(),
  busy: false,
  apiFailure: null as {
    kind?: 'chat' | 'recommendation' | 'retry-routes'
    message: string
    canResend: boolean
    retryAfterSeconds: number | null
    retryAt?: number
    retryable?: boolean
  } | null,
  scenario: 'normal',
  notice: null as Notice | null,
  progress: null as Progress | null,
  panel: null as Panel | null,
  drawer: false,
  detail: null as { id: string; resultId: string; expanded: boolean } | null,
  mapError: false,
  toast: '',
  hover: null as string | null,
  storageOK: true,
})

export function useDemoController() {
  const [store, setStore] = useState(loadStore)
  const storeRef = useRef(store)
  const [savedTrips, setSavedTrips] = useState(loadSavedTrips)
  const savedTripsRef = useRef(savedTrips)
  const [ui, setUI] = useState(() => ({
    ...initialUI(),
    notice: store.trips.find((t) => t.trip === store.activeTripId)?.workspaceView?.notice || null,
  }))
  const request = useRef(0)
  const apiRequests = useRef(new RequestManager())
  const lastApiCommand = useRef<LastApiCommand | null>(null)
  const retry = useRef<{ conditions: Conditions; fromChat: boolean } | null>(
    store.trips.find((t) => t.trip === store.activeTripId)?.workspaceView?.retry || null,
  )
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const active = store.trips.find((t) => t.trip === store.activeTripId)!
  const result = active.groups.find((g) => g.id === active.current) || active.general
  const currentSavedId = result ? `${active.trip}:${result.id}` : null
  const currentTripSaved = savedTrips.some((saved) => saved.id === currentSavedId)
  const layers =
    active.workspaceView?.layerDefaultsVersion === 1
      ? { ...defaultLayers, ...active.workspaceView.layers }
      : defaultLayers
  const patchUI = (patch: Partial<ReturnType<typeof initialUI>>) =>
    setUI((previous) => ({ ...previous, ...patch }))
  function updateStore(change: (draft: Store) => void) {
    const next = structuredClone(storeRef.current)
    change(next)
    storeRef.current = next
    setStore(next)
  }
  function updateTrip(change: (draft: Trip) => void) {
    updateStore((draft) => {
      const trip = draft.trips.find((t) => t.trip === draft.activeTripId)!
      change(trip)
      trip.updatedAt = new Date().toISOString()
    })
  }
  function getTrip() {
    return storeRef.current.trips.find((t) => t.trip === storeRef.current.activeTripId)!
  }
  function getResult(trip = getTrip()) {
    return trip.groups.find((g) => g.id === trip.current) || trip.general
  }
  function apiScope() {
    const trip = getTrip()
    return {
      tripId: trip.trip,
      version: trip.api?.version ?? 0,
      resultId: getResult(trip)?.id ?? null,
    }
  }
  function invalidateRequests(clearFailure = true) {
    request.current++
    apiRequests.current.cancel()
    if (clearFailure) setUI((previous) => ({ ...previous, apiFailure: null }))
  }
  async function sendApiAttempt(attempt: RequestAttempt) {
    const chat = attempt.path === '/chat/messages'
    patchUI({ busy: true, apiFailure: null, notice: null })
    try {
      const response = await apiClient.request<ConversationData>(attempt.path, {
        method: 'POST',
        body: attempt.body,
        signal: attempt.signal,
        // The recommendation engine has a 90-second processing budget.
        timeoutMs: chat ? 130000 : 100000,
      })
      if (!apiRequests.current.isCurrent(attempt, apiScope())) return
      // An HTTP error still may carry an already-applied condition update.
      if (
        response.envelope.request_id !== attempt.requestId ||
        (response.ok && !response.envelope.data)
      ) {
        throw new ApiTransportError(
          'protocol',
          '요청과 응답의 식별자가 일치하지 않아요.',
          response.status,
        )
      }
      updateTrip((trip) => {
        try {
          if (response.envelope.data && !applyConversationResponse(trip, attempt, response)) {
            throw new Error('응답 문맥 불일치')
          }
          if (
            chat &&
            trip.api?.clarification?.origin_context &&
            ['CONTEXT_EXPIRED', 'CONTEXT_CONDITIONS_MISMATCH', 'INVALID_CONTEXT'].includes(
              response.envelope.error?.code || '',
            )
          ) {
            trip.api.clarificationInvalid = response.envelope.error!.message
          }
        } catch {
          throw new ApiTransportError(
            'protocol',
            '서버 응답의 추천 정보나 여행 문맥을 확인할 수 없어요.',
            response.status,
          )
        }
      })
      if (chat && !response.ok && response.envelope.data?.condition_update.applied) {
        // A failed recommendation may have committed the selected origin already.
        lastApiCommand.current = {
          kind: 'chat',
          tripId: getTrip().trip,
          text: '현재 조건으로 다시 추천해줘',
          options: {},
        }
      }
      const stillRunning = response.envelope.error?.code === 'REQUEST_IN_PROGRESS'
      apiRequests.current.finish(
        attempt,
        stillRunning ? 'unknown' : 'received',
        response.retryAfterSeconds,
      )
      patchUI({
        busy: false,
        progress: null,
        notice:
          response.envelope.data &&
          (!chat || response.envelope.data.warnings.length > 0) &&
          (response.envelope.data.kind !== 'recommendation' ||
            response.envelope.data.warnings.length)
            ? {
                type: 'info',
                text: [
                  response.envelope.data.message,
                  ...response.envelope.data.warnings.map((w) => w.message),
                ].join('\n'),
              }
            : null,
        apiFailure: response.ok
          ? null
          : {
              kind: chat
                ? 'chat'
                : attempt.path.endsWith('/retry-routes')
                  ? 'retry-routes'
                  : 'recommendation',
              message: response.envelope.error?.message || '요청에 실패했어요.',
              canResend: stillRunning,
              retryAfterSeconds: response.retryAfterSeconds,
              retryAt: response.retryAfterSeconds
                ? Date.now() + response.retryAfterSeconds * 1000
                : 0,
              retryable: response.envelope.error?.retryable,
            },
      })
    } catch (error) {
      if (!apiRequests.current.isCurrent(attempt, apiScope())) return
      // No trustworthy response: the server may have committed. Preserve the exact command.
      const unknown = error instanceof ApiTransportError
      apiRequests.current.finish(attempt, unknown ? 'unknown' : 'received')
      patchUI({
        busy: false,
        progress: null,
        apiFailure: {
          kind: chat
            ? 'chat'
            : attempt.path.endsWith('/retry-routes')
              ? 'retry-routes'
              : 'recommendation',
          message: error instanceof Error ? error.message : '응답을 처리하지 못했어요.',
          canResend: unknown,
          retryAfterSeconds: null,
        },
      })
    }
  }
  async function recommendFromApi(conditionsPatch: ConditionsPatch) {
    if (ui.busy || apiRequests.current.busy || apiRequests.current.retryAfterSeconds > 0) return
    if (apiRequests.current.canResend) {
      notify('이전 요청의 처리 결과를 먼저 다시 확인해 주세요.')
      return
    }
    if (!getTrip().api)
      updateTrip((trip) => {
        trip.api = createServerTrip(trip.trip)
      })
    const trip = getTrip()
    const server = trip.api!
    const attempt = apiRequests.current.start(apiScope(), '/recommendations', {
      trip_id: server.tripId,
      condition_version: server.version,
      current_conditions: server.conditions,
      excluded_place_ids: [...new Set([...server.seenPlaceIds, ...trip.excluded])],
      conditions_patch: conditionsPatch,
    })
    if (attempt) {
      lastApiCommand.current = {
        kind: 'recommendation',
        tripId: trip.trip,
        patch: structuredClone(conditionsPatch),
      }
      await sendApiAttempt(attempt)
    }
  }
  async function retryApiRequest() {
    const attempt = apiRequests.current.retry(apiScope())
    if (attempt) await sendApiAttempt(attempt)
  }
  async function submitRecommendation(conditions: Conditions, onboarding = false) {
    const error = validateRecommendation(conditions)
    if (error) {
      notify(error)
      return
    }
    if (
      ui.busy ||
      apiRequests.current.busy ||
      apiRequests.current.canResend ||
      apiRequests.current.retryAfterSeconds > 0
    )
      return
    const patch = recommendationPatch(conditions, getTrip().api?.conditions)
    updateTrip((trip) => {
      trip.onboardingDraft = structuredClone(conditions)
      message(trip, `${conditionText(conditions)} 조건으로 찾아줘.`, {}, 'user')
    })
    patchUI({
      detail: null,
      panel: null,
      progress: {
        mode: 'search',
        stage: 'conditions',
        detail: '선택한 조건으로 추천을 찾고 있어요.',
        conditions,
      },
    })
    if (onboarding) navigate('main')
    await recommendFromApi(patch)
  }
  async function recommendMore() {
    if (!getTrip().api?.conditions.origin) {
      patchUI({ panel: { type: 'edit' } })
      notify('출발지를 검색해서 확인한 뒤 다시 추천받아 주세요.')
      return
    }
    await recommendFromApi({})
  }
  async function retryRecommendation() {
    if (apiRequests.current.canResend) return retryApiRequest()
    const last = lastApiCommand.current
    if (last?.tripId !== getTrip().trip) return
    if (last.kind === 'chat') await submitChat(last.text, last.options, true)
    else if (last.kind === 'retry-routes') {
      if (getResult()?.id === last.resultId) await retryRoute()
    } else await recommendFromApi(last.patch)
  }
  function notify(text: string) {
    clearTimeout(toastTimer.current)
    patchUI({ toast: text })
    toastTimer.current = setTimeout(() => patchUI({ toast: '' }), 4200)
  }
  useEffect(() => {
    try {
      const snapshot = structuredClone(store)
      const trip = snapshot.trips.find((t) => t.trip === snapshot.activeTripId)!
      trip.workspaceView = { ...trip.workspaceView, notice: ui.notice, retry: retry.current }
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
    } catch {
      queueMicrotask(() =>
        setUI((previous) => (previous.storageOK ? { ...previous, storageOK: false } : previous)),
      )
    }
  }, [store, ui.notice])
  useEffect(
    () => () => {
      invalidateRequests(false)
      clearTimeout(toastTimer.current)
    },
    [],
  )
  function navigate(page: string) {
    try {
      sessionStorage.setItem('seoul-start-screen-entered', '1')
      sessionStorage.setItem('seoul-entry-page', page === 'main' ? 'main' : 'map')
    } catch {
      /* Session storage is optional. */
    }
    patchUI({ page })
  }
  function message(trip: Trip, text: string, extra: Partial<Message> = {}, role = 'assistant') {
    trip.chat.push({ role, text, time: new Date().toISOString(), ...extra })
    trip.chat = trip.chat.slice(-120)
  }
  function commit(trip: Trip, response: Response, conditions: Conditions): Result {
    const group: Result = {
      id: `${trip.trip}-${++trip.sequence}`,
      number: trip.sequence,
      conditions: structuredClone(conditions),
      entries: response.entries!,
      time: response.time!,
    }
    trip.groups = [group, ...trip.groups].slice(0, 5)
    trip.current = group.id
    trip.selected = group.entries[0]?.id || null
    trip.seen = [...new Set([...trip.seen, ...group.entries.map((e) => e.id)])]
    trip.general = null
    trip.retainedResult = null
    return group
  }
  async function search(conditions: Conditions, fromChat = false, selectedScenario = ui.scenario) {
    if (getTrip().api) return submitRecommendation(conditions)
    const error = validateConditions(conditions)
    if (error) {
      notify(error)
      return
    }
    if (ui.busy) return
    const id = ++request.current,
      tripId = getTrip().trip
    const before = structuredClone(getTrip().conditions)
    const version = getTrip().conditionVersion
    const excluded = [...new Set([...getTrip().seen, ...getTrip().excluded])]
    if (!fromChat)
      updateTrip((t) => message(t, `${conditionText(conditions)} 조건으로 찾아줘.`, {}, 'user'))
    retry.current = { conditions: structuredClone(conditions), fromChat }
    patchUI({
      busy: true,
      scenario: 'normal',
      notice: null,
      detail: null,
      panel: ui.panel?.type === 'chat' ? ui.panel : null,
      ...(selectedScenario === 'map' ? { mapError: true } : {}),
      progress: {
        mode: 'search',
        stage: 'conditions',
        detail: '출발지와 선택한 조건을 확인하고 있어요.',
        conditions,
      },
    })
    const isActive = () =>
      request.current === id && getTrip().trip === tripId && getTrip().conditionVersion === version
    try {
      const response = await MockService.recommend({
        conditions,
        excluded,
        scenario: selectedScenario === 'map' ? 'normal' : selectedScenario,
        isActive,
        onProgress: (event) => {
          if (!isActive()) return false
          setUI((previous) => ({
            ...previous,
            progress: previous.progress ? { ...previous.progress, ...event } : null,
          }))
          return true
        },
      })
      if (!isActive() || response.cancelled) return
      let notice: Notice | null = null
      updateTrip((t) => {
        const previous = getResult(t)
        if (!response.accepted) {
          t.retainedResult = previous ? { id: previous.id, reason: 'failed' } : null
          notice = { text: response.error!, edit: true }
          message(t, response.error!, { fallback: true })
          return
        }
        t.conditions = structuredClone(conditions)
        t.conditionVersion++
        t.pendingChat = null
        if (t.general && !conditionsEqual(t.general.conditions, conditions)) {
          t.general = null
          t.current ||= t.groups[0]?.id || null
        }
        const changes = conditionChanges(before, conditions)
        if (response.error || !response.entries?.length) {
          if (!response.error) {
            t.general = null
            t.current ||= t.groups[0]?.id || null
          }
          const retained = getResult(t)
          t.retainedResult = retained
            ? { id: retained.id, reason: response.error ? 'failed' : 'empty' }
            : null
          notice = {
            text:
              response.error ||
              '조건에 맞는 새로운 장소가 없어요. 조건은 적용했고 이전 결과와 조회 시각은 그대로 유지했어요. 시간·키워드는 자동으로 완화하지 않아요.',
            edit: true,
          }
          message(t, [...changes, notice.text].join('\n'), { fallback: true })
          return
        }
        retry.current = null
        if (response.general) {
          t.retainedResult = null
          t.general = {
            id: `general-${tripId}-${id}`,
            entries: response.entries,
            conditions: structuredClone(conditions),
            time: response.time!,
          }
          t.current = null
          t.selected = response.entries[0].id
          notice = {
            text: '모든 후보의 경로 조회에 실패했어요. 일반 후보는 성공 추천이나 기록·자동 제외에 포함되지 않습니다. 같은 후보로 다시 확인할 수 있어요.',
          }
          message(t, '장소 후보는 찾았지만 이동시간을 확인하지 못했어요.', {
            resultId: t.general.id,
          })
        } else {
          const group = commit(t, response, conditions)
          notice = response.partial
            ? { text: '일부 경로 조회에 실패해 이동시간이 확인된 후보만 표시했어요.' }
            : response.explanationFailed
              ? {
                  text: '추천 설명 생성에 실패했어요. 검증된 후보의 순서·이동시간·기본 이유는 유지합니다.',
                }
              : null
          message(t, `${group.entries.length}곳을 골랐어요. 장소를 눌러 자세히 살펴보세요.`, {
            resultId: group.id,
          })
        }
      })
      patchUI({ busy: false, progress: null, notice })
    } catch {
      if (isActive())
        patchUI({
          busy: false,
          progress: null,
          notice: { text: '요청 처리에 실패했어요. 이전 결과를 유지합니다.', edit: true },
        })
    }
  }
  async function startTrip(conditions: Conditions) {
    const invalid = validateConditions(conditions)
    if (invalid) {
      notify(invalid)
      return
    }
    updateTrip((t) => {
      t.onboardingComplete = true
      t.onboardingDraft = structuredClone(conditions)
      t.conditions = structuredClone(conditions)
      t.conditionVersion++
      message(
        t,
        `여행 조건을 확인했어요.\n${conditionText(conditions)}\n지금 출발하는 기준으로 장소를 찾아볼게요.`,
      )
    })
    navigate('main')
    const pending = search(conditions, true)
    await pending
  }
  function preserveWorkspace() {
    updateTrip((t) => {
      t.workspaceView = { ...t.workspaceView, notice: ui.notice, retry: retry.current }
      if (ui.busy)
        message(t, '여행을 바꾸면서 진행 중인 요청을 멈췄어요. 이 여행에서 이어서 요청해 주세요.')
    })
  }
  function switchTrip(tripId: string) {
    preserveWorkspace()
    invalidateRequests()
    updateStore((s) => {
      s.activeTripId = tripId
    })
    patchUI({
      busy: false,
      progress: null,
      panel: null,
      detail: null,
      drawer: false,
      notice: getTrip().workspaceView?.notice || null,
      mapError: false,
    })
    retry.current = getTrip().workspaceView?.retry || null
    navigate('main')
  }
  function newTrip() {
    preserveWorkspace()
    retry.current = null
    const trip = newState()
    invalidateRequests()
    updateStore((s) => {
      s.trips.unshift(trip)
      s.activeTripId = trip.trip
    })
    patchUI({
      busy: false,
      progress: null,
      panel: null,
      detail: null,
      drawer: false,
      notice: null,
      mapError: false,
    })
    navigate('main')
  }
  function deleteTrip(tripId: string) {
    const wasActive = getTrip().trip === tripId
    if (wasActive) invalidateRequests()
    updateStore((s) => {
      s.trips = s.trips.filter((t) => t.trip !== tripId)
      if (!s.trips.length) s.trips.push(newState())
      if (wasActive) s.activeTripId = s.trips[0].trip
    })
    patchUI({
      panel: null,
      ...(wasActive ? { busy: false, progress: null, detail: null, notice: null } : {}),
    })
    notify('여행을 삭제했어요.')
  }
  function activateResult(resultId: string, selectedId?: string) {
    const target = [...getTrip().groups, ...(getTrip().general ? [getTrip().general!] : [])].find(
      (g) => g.id === resultId,
    )
    if (!target) {
      notify('보관 기간이 지난 추천이에요.')
      return
    }
    if (
      getResult()?.id !== target.id ||
      !conditionsEqual(getTrip().conditions, target.conditions)
    ) {
      invalidateRequests()
      patchUI({ busy: false, progress: null })
    }
    updateTrip((t) => {
      if (
        !t.api &&
        (getResult(t)?.id !== target.id || !conditionsEqual(t.conditions, target.conditions))
      ) {
        t.conditions = structuredClone(target.conditions)
        t.conditionVersion++
        t.pendingChat = null
        message(t, `이전 추천의 조건으로 이어서 이야기해요.\n${conditionText(target.conditions)}`, {
          kind: 'context-switch',
        })
      }
      t.current = t.general?.id === target.id ? null : target.id
      t.selected = selectedId || target.entries[0]?.id || null
      t.retainedResult = null
    })
    patchUI({ notice: null, detail: null })
  }
  function openDetail(id: string, resultId = result?.id) {
    if (!resultId) return
    activateResult(resultId, id)
    patchUI({
      panel: ui.panel?.type === 'chat' ? null : ui.panel,
      detail: { id, resultId, expanded: false },
    })
  }
  async function retryRoute() {
    if (getTrip().api) {
      if (!canStartApiRequest()) return
      const trip = getTrip(),
        server = trip.api!,
        general = trip.general
      if (!general?.api || getResult()?.id !== general.id) return
      if (resultContextStatus(general) !== 'available') {
        notify('후보의 조회 시간이 지났어요. 기존 후보는 유지하며 새로 추천받을 수 있어요.')
        return
      }
      if (!conditionsEqual(displayConditions(server.conditions), general.conditions)) {
        notify('현재 조건이 후보를 찾았을 때와 달라요. 현재 조건으로 새로 추천받아 주세요.')
        return
      }
      const attempt = apiRequests.current.start(apiScope(), '/recommendations/retry-routes', {
        trip_id: server.tripId,
        condition_version: server.version,
        current_conditions: server.conditions,
        excluded_place_ids: [...new Set([...server.seenPlaceIds, ...trip.excluded])],
        result_id: general.id,
        context_token: general.api.result.context_token,
      })
      if (!attempt) return
      lastApiCommand.current = { kind: 'retry-routes', tripId: trip.trip, resultId: general.id }
      patchUI({
        progress: {
          mode: 'route',
          stage: 'routes',
          detail: '같은 후보의 이동시간을 다시 확인하고 있어요.',
          conditions: general.conditions,
        },
      })
      await sendApiAttempt(attempt)
      return
    }
    const general = getTrip().general
    if (!general || ui.busy) return
    if (!conditionsEqual(general.conditions, getTrip().conditions)) {
      patchUI({
        notice: { text: '조건이 바뀌었어요. 새 조건으로 다시 탐색해 주세요.', edit: true },
      })
      return
    }
    const id = ++request.current
    patchUI({
      busy: true,
      progress: {
        mode: 'route',
        stage: 'routes',
        detail: '찾아둔 후보의 이동시간을 다시 확인하고 있어요.',
        conditions: general.conditions,
      },
    })
    const response = await MockService.route({ general })
    if (id !== request.current) return
    updateTrip((t) => {
      response.entries = response.entries?.filter(
        (e) => !t.excluded.includes(e.id) && !t.seen.includes(e.id),
      )
      if (response.entries?.length) {
        const group = commit(t, response, general.conditions)
        message(t, '같은 후보의 이동시간을 확인했어요.', { resultId: group.id })
      } else t.general = null
    })
    patchUI({
      busy: false,
      progress: null,
      notice: {
        text: response.entries?.length
          ? '일반 후보의 이동시간을 확인해 성공 추천으로 저장했어요.'
          : '재검증할 수 있는 후보가 없어요.',
        type: 'info',
      },
    })
  }
  function canStartApiRequest() {
    if (ui.busy || apiRequests.current.busy) return false
    if (apiRequests.current.canResend) {
      notify('이전 요청의 처리 결과를 먼저 다시 확인해 주세요.')
      return false
    }
    if (apiRequests.current.retryAfterSeconds > 0) {
      notify(`${apiRequests.current.retryAfterSeconds}초 후 다시 시도해 주세요.`)
      return false
    }
    return true
  }
  async function submitChat(text: string, options: ChatOptions = {}, retrying = false) {
    const content = text.trim()
    if (!content || !canStartApiRequest()) return false
    if ([...content].length > 500) {
      notify('메시지는 500자 이내로 입력해 주세요.')
      return false
    }
    if (!getTrip().api)
      updateTrip((trip) => {
        trip.api = createServerTrip(trip.trip)
      })
    const trip = getTrip(),
      server = trip.api!
    const pending = server.clarification
    const invalidOrigin = originContextUnavailable(trip)
    const action = options.originAction
    if (action) {
      const context = pending?.origin_context
      if (
        !context ||
        invalidOrigin ||
        context.context_token !== action.context_token ||
        options.target ||
        context.mode === 'confirmed' ||
        (action.action === 'select' &&
          !originChoices(pending!).some(
            (choice) => choice.value.candidate_id === action.candidate_id,
          ))
      ) {
        notify(invalidOrigin || '새 출발지 질문을 확인한 뒤 다시 선택해 주세요.')
        return false
      }
    }
    if (options.target) {
      const result = getResult()
      if (
        !result?.api ||
        result.id !== options.target.result_id ||
        !result.entries.some((entry) => entry.id === options.target!.place_id) ||
        result.api.result.context_token !== options.target.context_token ||
        resultContextStatus(result) !== 'available'
      ) {
        notify(
          '추천 정보의 조회 시간이 지났어요. 기존 카드는 유지하며 새 추천에서 다시 질문할 수 있어요.',
        )
        return false
      }
    }
    const currentResult = getResult()
    const selectedId = trip.selected
    const contextualTarget =
      !action &&
      currentResult?.api &&
      currentResult.entries.some((entry) => entry.id === selectedId) &&
      resultContextStatus(currentResult) === 'available'
        ? {
            result_id: currentResult.id,
            place_id: selectedId,
            context_token: currentResult.api.result.context_token!,
          }
        : undefined
    const target = options.target ?? contextualTarget
    const body = {
      trip_id: server.tripId,
      condition_version: server.version,
      current_conditions: server.conditions,
      excluded_place_ids: [...new Set([...server.seenPlaceIds, ...trip.excluded])],
      message: content,
      recent_messages: recentChatMessages(trip),
      ...(pending && !invalidOrigin ? { pending_clarification: pending } : {}),
      ...(action ? { origin_action: action } : {}),
      ...(target ? { target } : {}),
    }
    const attempt = apiRequests.current.start(apiScope(), '/chat/messages', body)
    if (!attempt) return false
    lastApiCommand.current = {
      kind: 'chat',
      tripId: trip.trip,
      text: content,
      options: structuredClone(options),
    }
    updateTrip((draft) => {
      draft.workspaceView = { ...draft.workspaceView, chatDraft: '' }
      if (invalidOrigin) {
        draft.api!.clarification = null
        draft.api!.clarificationInvalid = null
      }
      if (!retrying) message(draft, content, {}, 'user')
    })
    patchUI({
      progress: {
        mode: 'interpret',
        stage: 'conditions',
        detail: '메시지와 필요한 조건을 확인하고 있어요.',
        conditions: null,
      },
    })
    await sendApiAttempt(attempt)
    return true
  }
  function restartExpiredOrigin() {
    if (!canStartApiRequest()) return
    updateTrip((trip) => {
      if (trip.api) {
        trip.api.clarification = null
        trip.api.clarificationInvalid = null
      }
    })
    patchUI({ apiFailure: null, notice: null })
    notify('출발지와 원하는 조건을 다시 입력해 주세요. 기존 조건과 추천은 유지돼요.')
  }
  function askSelectedPlace(text: string) {
    const result = getResult(),
      selected = getTrip().selected
    if (!result?.api || !selected || !result.api.result.context_token) {
      notify('추천 목록에서 질문할 장소를 먼저 선택해 주세요.')
      return Promise.resolve(false)
    }
    return submitChat(text, {
      target: {
        result_id: result.id,
        place_id: selected,
        context_token: result.api.result.context_token,
      },
    })
  }

  function toggleLayer(key: keyof Layers) {
    updateTrip((t) => {
      const current =
        t.workspaceView?.layerDefaultsVersion === 1
          ? { ...defaultLayers, ...t.workspaceView.layers }
          : { ...defaultLayers }
      current[key] = !current[key]
      t.workspaceView = { ...t.workspaceView, layers: current, layerDefaultsVersion: 1 }
    })
  }
  function saveMap(view: MapView) {
    updateTrip((t) => {
      t.workspaceView = { ...t.workspaceView, map: view }
    })
  }
  function exclude(id: string) {
    updateTrip((t) => {
      if (!t.excluded.includes(id)) t.excluded.push(id)
    })
    notify('다음 탐색에서 제외돼요. 현재 카드와 마커는 그대로 남겨두었어요.')
  }
  function excludeGeneral() {
    updateTrip((t) => {
      t.excluded = [...new Set([...t.excluded, ...(t.general?.entries.map((e) => e.id) || [])])]
      t.general = null
    })
    void search(getTrip().conditions)
  }
  function renameTrip(id: string, title: string) {
    if (!title.trim()) return
    updateStore((s) => {
      const trip = s.trips.find((t) => t.trip === id)
      if (trip) trip.title = title.trim().slice(0, 40)
    })
    patchUI({ panel: null })
  }
  function updateDraft(conditions: Conditions) {
    updateTrip((t) => {
      t.onboardingDraft = conditions
    })
  }
  function showChat() {
    patchUI({
      detail: ui.detail,
      panel: matchMedia('(min-width:901px)').matches ? null : { type: 'chat' },
    })
    requestAnimationFrame(() => document.getElementById('chat-input')?.focus())
  }
  function saveCurrentTrip() {
    const trip = getTrip(),
      displayed = getResult(trip)
    if (!displayed?.entries.length) {
      notify('장소를 추천받은 뒤 여행을 저장해 주세요.')
      return
    }
    const id = `${trip.trip}:${displayed.id}`
    if (savedTripsRef.current.some((saved) => saved.id === id)) {
      notify('이미 저장한 여행이에요.')
      return
    }
    const saved: SavedTrip = {
      id,
      ...(trip.api ? { api: structuredClone(trip.api) } : {}),
      sourceTripId: trip.trip,
      title:
        trip.title ||
        `${displayed.conditions.departure} · ${displayed.conditions.purposes.join('·')}`,
      savedAt: new Date().toISOString(),
      result: structuredClone(displayed),
      selectedId: trip.selected,
      parkingSelections: structuredClone(trip.parkingSelections || {}),
      parkingDetails: structuredClone(trip.parkingDetails || {}),
      general: trip.general?.id === displayed.id,
      layers: structuredClone(trip.workspaceView?.layers || defaultLayers),
    }
    const next = [saved, ...savedTripsRef.current]
    try {
      persistSavedTrips(next)
    } catch {
      notify('여행을 저장하지 못했어요. 브라우저 저장 공간과 설정을 확인해 주세요.')
      return
    }
    savedTripsRef.current = next
    setSavedTrips(next)
    notify('여행을 저장했어요. 북마크 메뉴에서 다시 볼 수 있어요.')
  }
  function removeSavedTrip(id: string) {
    const next = savedTripsRef.current.filter((saved) => saved.id !== id)
    try {
      persistSavedTrips(next)
    } catch {
      notify('저장을 해제하지 못했어요. 다시 시도해 주세요.')
      return
    }
    savedTripsRef.current = next
    setSavedTrips(next)
    notify('여행 저장을 해제했어요.')
  }
  function openSavedTrip(id: string) {
    const saved = savedTripsRef.current.find((item) => item.id === id)
    if (!saved) {
      notify('저장한 여행을 찾지 못했어요.')
      return
    }
    preserveWorkspace()
    invalidateRequests()
    retry.current = null
    updateStore((draft) => {
      let trip = draft.trips.find((t) => t.trip === saved.sourceTripId)
      if (!trip) {
        trip = newState()
        trip.trip = saved.sourceTripId
        trip.title = saved.title
        draft.trips.unshift(trip)
      }
      const restored = structuredClone(saved.result)
      trip.parkingSelections = structuredClone(saved.parkingSelections || {})
      trip.parkingDetails = structuredClone(saved.parkingDetails || {})
      if (restored.api) {
        trip.api ??= structuredClone(
          saved.api || {
            tripId: restored.api.tripId,
            version: restored.api.conditionVersion,
            seenPlaceIds: saved.general ? [] : restored.entries.map((entry) => entry.id),
            conditions: restored.api.result.conditions,
            clarification: null,
          },
        )
      }
      trip.conditions = trip.api
        ? displayConditions(trip.api.conditions)
        : structuredClone(restored.conditions)
      trip.onboardingDraft = structuredClone(trip.conditions)
      trip.onboardingComplete = true
      if (trip.api) trip.conditionVersion = trip.api.version
      else trip.conditionVersion++
      trip.pendingChat = null
      trip.retainedResult = null
      trip.selected = restored.entries.some((entry) => entry.id === saved.selectedId)
        ? saved.selectedId
        : restored.entries[0].id
      trip.workspaceView = { layers: structuredClone(saved.layers), layerDefaultsVersion: 1 }
      if (saved.general) {
        trip.general = restored
        trip.current = null
      } else {
        trip.general = null
        trip.current = restored.id
        trip.groups = [restored, ...trip.groups.filter((group) => group.id !== restored.id)].slice(
          0,
          5,
        )
        trip.sequence = Math.max(trip.sequence, restored.number || 1)
        trip.seen = [...new Set([...trip.seen, ...restored.entries.map((entry) => entry.id)])]
      }
      // Show this recommendation once, at the latest restore message, while keeping earlier text.
      for (const previous of trip.chat) {
        if (previous.resultId === restored.id) delete previous.resultId
      }
      message(
        trip,
        '저장한 여행을 다시 열었어요. 저장 당시 추천 장소와 조회 시각을 그대로 보여드려요.',
        { resultId: restored.id },
      )
      trip.updatedAt = new Date().toISOString()
      draft.activeTripId = trip.trip
    })
    patchUI({
      busy: false,
      progress: null,
      panel: null,
      drawer: false,
      detail: null,
      notice: null,
      mapError: false,
      scenario: 'normal',
    })
    navigate('main')
    notify('저장한 여행의 추천 장소를 다시 불러왔어요.')
  }
  return {
    store,
    active,
    result,
    savedTrips,
    currentTripSaved,
    saveCurrentTrip,
    removeSavedTrip,
    openSavedTrip,
    openSavedTrips: () => patchUI({ drawer: false, panel: { type: 'saved-trips' }, toast: '' }),
    layers,
    ui,
    patchUI,
    notify,
    navigate,
    search,
    startTrip,
    switchTrip,
    newTrip,
    deleteTrip,
    renameTrip,
    activateResult,
    openDetail,
    retryRoute,
    submitChat,
    askSelectedPlace,
    restartExpiredOrigin,
    recommendFromApi,
    retryApiRequest,
    submitRecommendation,
    recommendMore,
    retryRecommendation,
    toggleLayer,
    saveMap,
    exclude,
    excludeGeneral,
    updateDraft,
    updateChatDraft: (chatDraft: string) =>
      updateTrip((t) => {
        t.workspaceView = { ...t.workspaceView, chatDraft }
      }),
    showChat,
    retrySearch: () => retry.current && search(retry.current.conditions, retry.current.fromChat),
    selectParking: (
      placeId: string,
      parkingId: string,
      facility?: import('./parking/facilities').ParkingFacility,
    ) => {
      if (!getResult()?.entries.some((entry) => entry.id === placeId)) return
      updateTrip((t) => {
        t.parkingSelections = { ...t.parkingSelections, [placeId]: parkingId }
        if (facility?.id === parkingId)
          t.parkingDetails = { ...t.parkingDetails, [parkingId]: structuredClone(facility) }
      })
      notify('이 장소에서 이용할 주차장을 선택했어요.')
    },
    selectPlace: (id: string) =>
      updateTrip((t) => {
        t.selected = id
      }),
    openEdit: () => patchUI({ panel: { type: 'edit' } }),
    closePanel: () => patchUI({ panel: null }),
  }
}
export type DemoContextValue = ReturnType<typeof useDemoController>
export const DemoContext = createContext<DemoContextValue | null>(null)
