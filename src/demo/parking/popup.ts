import type { MapRecord } from '../mapLayers'
import type { ParkingLot } from './types'

// Popup state holds IDs from the click; displayed values always come from the latest snapshot.
export function resolveParkingPopup(record: MapRecord, lots: ParkingLot[]): MapRecord {
  const current = new Map(lots.map((lot) => [lot.id, lot]))
  if (record.kind === 'parking')
    return {
      ...record,
      data: {
        ...record.data,
        records: record.data.records.flatMap((lot) =>
          current.has(lot.id) ? [current.get(lot.id)!] : [],
        ),
      },
    }
  if (record.kind === 'parking-cluster')
    return {
      ...record,
      data: record.data.flatMap((item) => {
        const lot = current.get(item.record.id)
        return lot ? [{ ...item, record: lot }] : []
      }),
    }
  return record
}
