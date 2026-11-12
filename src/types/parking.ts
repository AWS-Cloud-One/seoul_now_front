export type ParkingScope = 'map'
export type ParkingLot = {
  api?: {
    facility: import('../api/queries').ParkingFacilityData
    comparison?: Pick<
      import('../api/queries').ParkingSearchItem,
      'fee_status' | 'hourly_base_comparison_krw' | 'fee_reason'
    >
    detail?: import('../api/queries').ParkingDetail
  }
  code?: string | null
  id: string
  name: string
  lat: number | null
  lng: number | null
  capacity: number | null
  available: number | null
  address: string | null
  kind: string | null
  source: string | null
  collectedAt: string | null
  feeStatus: string | null
  baseRate: { amount: number; minutes: number } | null
  hours: Record<string, [string, string]>
}
export type ParkingSource = {
  kind: 'api'
  initialData?: Partial<Record<ParkingScope, unknown>>
  load(
    scope: ParkingScope,
    signal: AbortSignal,
    query?: import('../api/queries').MapQuery,
  ): Promise<unknown>
}
export type ParkingSnapshot = {
  lots: import('../lib/parking/facilities').ParkingFacility[]
  status: 'idle' | 'loading' | 'success' | 'error'
  error: string | null
  refreshing: boolean
}
