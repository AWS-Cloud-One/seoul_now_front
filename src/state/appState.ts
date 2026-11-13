import { createContext, useEffect, useRef, useState } from 'react'
import { loadSavedTrips, persistSavedTrips } from './savedTrips'
import { initialPage, loadStore, STORAGE_KEY } from './tripStorage'
import { apiClient, ApiTransportError } from '../api/client'
import type { ChatTarget, ConditionsPatch, ConversationData, OriginAction } from '../api/contracts'
import { originChoices, originContextUnavailable, recentChatMessages } from '../lib/chatContext'
import { RequestManager } from '../api/requestManager'
import type { RequestAttempt } from '../api/requestManager'
import { recommendationPatch, validateRecommendation } from '../lib/recommendationConditions'
import {
  applyConversationResponse,
  createServerTrip,
  displayConditions,
  resultContextStatus,
} from './apiState'
import { conditionsEqual, conditionText, newState } from '../lib/domain.js'
import type {
  Conditions,
  Layers,
  MapView,
  Message,
  Notice,
  Panel,
  Progress,
  SavedTrip,
  Store,
  Trip,
} from '../types/trip'

type ChatOptions = { originAction?: OriginAction; target?: ChatTarget }
type LastApiCommand =
  | { kind: 'recommendation'; tripId: string; patch: ConditionsPatch }
  | { kind: 'chat'; tripId: string; text: string; options: ChatOptions }
  | { kind: 'retry-routes'; tripId: string; resultId: string }

const defaultLayers: Layers = { roads: true, parking: true, population: true }
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
  notice: null as Notice | null,
  progress: null as Progress | null,
  panel: null as Panel | null,
  drawer: false,
  detail: null as { id: string; resultId: string; expanded: boolean } | null,
  toast: '',
  toastAction: null as { label: string; onClick: () => void } | null,
  hover: null as string | null,
  storageOK: true,
})

export function useAppStateController() {
  const [store, setStore] = useState(loadStore)
  const storeRef = useRef(store)
  const [savedTrips, setSavedTrips] = useState(loadSavedTrips)
  const savedTripsRef = useRef(savedTrips)
  const [ui, setUI] = useState(() => ({
    ...initialUI(),
    notice: store.trips.find((t) => t.trip === store.activeTripId)?.workspaceView?.notice || null,
  }))
  const apiRequests = useRef(new RequestManager())
  const lastApiCommand = useRef<LastApiCommand | null>(null)
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
  function notify(text: string, action: { label: string; onClick: () => void } | null = null) {
    clearTimeout(toastTimer.current)
    patchUI({ toast: text, toastAction: action })
    toastTimer.current = setTimeout(
      () => patchUI({ toast: '', toastAction: null }),
      action ? 8000 : 4200,
    )
  }
  function dismissToast() {
    clearTimeout(toastTimer.current)
    patchUI({ toast: '', toastAction: null })
  }
  useEffect(() => {
    try {
      const snapshot = structuredClone(store)
      const trip = snapshot.trips.find((t) => t.trip === snapshot.activeTripId)!
      trip.workspaceView = { ...trip.workspaceView, notice: ui.notice }
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
  function preserveWorkspace() {
    updateTrip((t) => {
      t.workspaceView = { ...t.workspaceView, notice: ui.notice }
      if (ui.busy)
        message(t, '여행을 바꾸면서 진행 중인 요청을 멈췄어요. 이 여행에서 이어서 요청해 주세요.')
    })
  }
  function newTrip() {
    preserveWorkspace()
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
    })
    navigate('main')
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
    // Only server results can be re-routed; there is no local recommendation engine.
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
  function updateDraft(conditions: Conditions) {
    updateTrip((t) => {
      t.onboardingDraft = conditions
    })
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
    layers,
    ui,
    patchUI,
    notify,
    dismissToast,
    navigate,
    newTrip,
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
    updateDraft,
    updateChatDraft: (chatDraft: string) =>
      updateTrip((t) => {
        t.workspaceView = { ...t.workspaceView, chatDraft }
      }),
    selectParking: (
      placeId: string,
      parkingId: string,
      facility?: import('../lib/parking/facilities').ParkingFacility,
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
export type AppStateValue = ReturnType<typeof useAppStateController>
export const AppStateContext = createContext<AppStateValue | null>(null)
