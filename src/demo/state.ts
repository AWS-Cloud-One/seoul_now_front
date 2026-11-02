import { createContext, useEffect, useRef, useState } from 'react'
import { loadSavedTrips, persistSavedTrips } from './savedTrips'
import {
  conditionChanges,
  conditionsEqual,
  conditionText,
  MockService,
  newState,
  normalizeTrip,
  patchConditions,
  placeById,
  validSavedTrip,
  validateConditions,
  dateLabel,
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

const STORAGE_KEY = 'seoul-next-stop-trips-v2'
const defaultLayers: Layers = { roads: true, parking: true, population: true }
function loadStore(): Store {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null')
    if (saved?.schema === 2 && Array.isArray(saved.trips)) {
      const trips: Trip[] = saved.trips.filter(validSavedTrip).map(normalizeTrip)
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
      request.current++
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
    if (!matchMedia('(min-width:901px)').matches) patchUI({ panel: { type: 'chat' } })
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
    request.current++
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
    request.current++
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
    if (wasActive) request.current++
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
      request.current++
      patchUI({ busy: false, progress: null })
    }
    updateTrip((t) => {
      if (getResult(t)?.id !== target.id || !conditionsEqual(t.conditions, target.conditions)) {
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
  async function submitChat(text: string) {
    if (!text.trim() || ui.busy) return
    if (!getTrip().onboardingComplete) {
      notify('출발지와 방문 목적을 먼저 선택해 주세요.')
      return
    }
    const id = ++request.current
    updateTrip((t) => {
      t.workspaceView = { ...t.workspaceView, chatDraft: '' }
      message(t, text.trim(), {}, 'user')
    })
    patchUI({
      busy: true,
      progress: {
        mode: 'interpret',
        stage: 'conditions',
        detail: '메시지에서 요청과 필요한 조건을 확인하고 있어요.',
        conditions: null,
      },
    })
    const parsed = await MockService.interpret(text)
    if (id !== request.current) return
    patchUI({ busy: false, progress: null })
    if (parsed.kind === 'question') {
      const current = getResult(),
        trip = getTrip(),
        place = placeById(trip.selected)
      const entry = current?.entries.find((e) => e.id === place?.id)
      if (!place || !entry || !current) {
        updateTrip((t) =>
          message(t, '어느 장소가 궁금하세요? 목록이나 지도에서 장소를 선택해 주세요.'),
        )
        return
      }
      let answer = ''
      if (parsed.question === 'reason')
        answer = `${place.name}을 제안한 당시 이유예요.\n${entry.reason}\n당시 조건: ${conditionText(current.conditions)}\n원래 조회: ${dateLabel(entry.queryTime)}. 당시 판단과 조회 시각을 유지했어요.`
      else if (parsed.question === 'parking')
        answer =
          '현재 빈자리는 확인할 수 없어요. 주변 주차장 목록과 직선거리만 제공하는 모의 데이터예요. 주차 정보가 없더라도 주차장이 없다는 뜻은 아닙니다.'
      else {
        patchUI({
          busy: true,
          progress: {
            mode: 'question',
            stage: 'routes',
            detail: '선택한 장소의 이동시간을 별도로 확인하고 있어요.',
            conditions: null,
          },
        })
        const traffic = await MockService.traffic(place.id, current.conditions)
        if (id !== request.current) return
        answer = `별도 교통 조회: 자동차 약 ${traffic.eta}분. 조회 ${dateLabel(traffic.time)}.\n원래 추천은 ${entry.eta === null ? '이동시간 확인 불가' : entry.eta + '분'}, ${dateLabel(entry.queryTime)} 조회로 유지해요. 실시간 정보가 아닙니다.`
      }
      updateTrip((t) => message(t, answer, { place: place.name }))
      patchUI({ busy: false, progress: null })
      return
    }
    if (parsed.kind === 'alternatives') {
      await search(getTrip().conditions, true)
      return
    }
    if (parsed.kind === 'unsupported') {
      updateTrip((t) =>
        message(
          t,
          '이 자유 입력은 해석하지 못했어요. 실제 AI가 아니므로 임의로 조건을 바꾸지 않습니다. 아래 예시를 사용하거나 조건을 직접 입력해 주세요.',
          { fallback: true },
        ),
      )
      return
    }
    const pending = getTrip().pendingChat
    const patch = { ...pending?.patch, ...parsed.patch }
    const candidate = patchConditions(getTrip().conditions, patch)
    let clarification = parsed.kind === 'clarify' ? parsed.message : validateConditions(candidate)
    if (pending?.need && !Object.hasOwn(parsed.patch || {}, pending.need))
      clarification =
        pending.need === 'headcount'
          ? '정확한 인원을 알려주세요. 예: 6명'
          : pending.need === 'departure'
            ? '출발지를 한 곳으로 알려주세요. 예: 서울역'
            : '목적 한두 가지를 다시 알려주세요. 예: 카페, 산책'
    if (clarification) {
      updateTrip((t) => {
        t.pendingChat = {
          patch,
          need:
            parsed.need ||
            (!candidate.departure
              ? 'departure'
              : !candidate.purposes.length
                ? 'purposes'
                : pending?.need),
        }
        message(t, clarification!, { fallback: true })
      })
      return
    }
    updateTrip((t) => {
      t.pendingChat = null
    })
    await search(candidate, true)
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
      sourceTripId: trip.trip,
      title:
        trip.title ||
        `${displayed.conditions.departure} · ${displayed.conditions.purposes.join('·')}`,
      savedAt: new Date().toISOString(),
      result: structuredClone(displayed),
      selectedId: trip.selected,
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
    request.current++
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
      trip.conditions = structuredClone(restored.conditions)
      trip.onboardingDraft = structuredClone(restored.conditions)
      trip.onboardingComplete = true
      trip.conditionVersion++
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
