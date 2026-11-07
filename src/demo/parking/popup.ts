import type { MapRecord } from '../mapLayers'
import type { ParkingLot } from './types'

// Popup state holds IDs from the click; displayed values always come from the latest snapshot.
export function resolveParkingPopup(
  record: MapRecord,
  lots: (ParkingLot & { memberIds?: string[] })[],
): MapRecord {
  const current = new Map<string, ParkingLot>()
  for (const lot of lots) {
    current.set(lot.id, lot)
    for (const id of lot.memberIds ?? []) current.set(id, lot)
  }
  const seen = new Set<string>()
  const resolve = (id: string) => {
    const lot = current.get(id)
    if (!lot || seen.has(lot.id)) return undefined
    seen.add(lot.id)
    return lot
  }
  if (record.kind === 'parking')
    return {
      ...record,
      data: {
        ...record.data,
        records: record.data.records.flatMap(({ id }) => {
          const lot = resolve(id)
          return lot ? [lot] : []
        }),
      },
    }
  if (record.kind === 'parking-cluster')
    return {
      ...record,
      data: record.data.flatMap((item) => {
        const lot = resolve(item.record.id)
        return lot ? [{ ...item, location: { ...item.location, records: [lot] }, record: lot }] : []
      }),
    }
  return record
}
