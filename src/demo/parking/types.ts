export type ParkingScope = 'preview' | 'map'
export type ParkingLot = {
  id: string
  name: string
  lat: number | null
  lng: number | null
  capacity: number | null
  available: number | null
  previewPosition: { x: number; y: number } | null
  address: string | null
  kind: string | null
  source: string | null
  collectedAt: string | null
  feeStatus: string | null
  baseRate: { amount: number; minutes: number } | null
  hours: Record<string, [string, string]>
}
export type ParkingSource = {
  kind: 'mock' | 'api'
  initialData?: Partial<Record<ParkingScope, unknown>>
  load(scope: ParkingScope, signal: AbortSignal): Promise<unknown>
}
export type ParkingSnapshot = {
  lots: ParkingLot[]
  status: 'idle' | 'loading' | 'success' | 'error'
  error: string | null
  refreshing: boolean
}
