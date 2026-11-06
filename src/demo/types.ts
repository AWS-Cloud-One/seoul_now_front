export type Conditions = {
  departure: string | null
  purposes: string[]
  keyword: string | null
  group: string | null
  ages: string[]
  headcount: number | null
  maxMinutes: number | null
}
export type Parking = {
  name: string
  distance: number
  source: string
  measured: string
  collected: string
}
export type Place = {
  id: string
  name: string
  category: string
  area: string
  district?: string
  lat: number
  lon: number
  address: string
  description?: string
  photoUrl?: string | null
  tags?: string[]
  parking: Parking[] | null
  parkingRadius: number
  legacy?: boolean
}
export type Entry = {
  id: string
  photoUrl?: string | null
  eta: number | null
  queryTime: string
  reason: string
  parkingUnknown?: boolean
  sourceStatus: string
}
export type Result = {
  id: string
  number?: number
  entries: Entry[]
  conditions: Conditions
  time: string
}
export type Message = {
  role: string
  text: string
  time: string
  resultId?: string
  place?: string
  fallback?: boolean
  kind?: string
}
export type Layers = { roads: boolean; parking: boolean; population: boolean }
export type MapView = { center?: [number, number]; zoom?: number; resultId?: string }
export type Trip = {
  schema: number
  trip: string
  title: string
  createdAt: string
  updatedAt: string
  conditionVersion: number
  conditions: Conditions
  onboardingComplete: boolean
  onboardingDraft: Conditions
  groups: Result[]
  seen: string[]
  excluded: string[]
  general: Result | null
  chat: Message[]
  parkingSelections?: Record<string, string>
  pendingChat: { patch: Partial<Conditions>; need?: string } | null
  current: string | null
  selected: string | null
  view: string
  sequence: number
  retainedResult: { id: string; reason: string } | null
  workspaceView: {
    layers?: Layers
    layerDefaultsVersion?: number
    map?: MapView
    chatDraft?: string
    notice?: Notice | null
    retry?: { conditions: Conditions; fromChat: boolean } | null
  } | null
}
export type Store = { schema: number; activeTripId: string; trips: Trip[] }
export type SavedTrip = {
  id: string
  sourceTripId: string
  title: string
  savedAt: string
  result: Result
  parkingSelections?: Record<string, string>
  selectedId: string | null
  general: boolean
  layers: Layers
}
export type Progress = {
  mode: string
  stage: string
  detail: string
  conditions: Conditions | null
}
export type Response = {
  accepted?: boolean
  cancelled?: boolean
  error?: string
  entries?: Entry[]
  time?: string
  general?: boolean
  partial?: boolean
  explanationFailed?: boolean
}
export type Parsed = {
  kind: string
  question?: string
  patch?: Partial<Conditions>
  need?: string
  message?: string
}
export type Notice = { text: string; edit?: boolean; type?: string }
export type Panel = { type: string; tripId?: string; placeId?: string }
