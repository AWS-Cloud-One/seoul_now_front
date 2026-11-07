import type { ParkingLot } from './types'

export type ParkingFacility = ParkingLot & { memberIds: string[] }

/** A provider may publish each street-parking bay as a separate coordinate. */
export function parkingFacilities(lots: ParkingLot[]): ParkingFacility[] {
  const groups = new Map<string, ParkingLot[]>()
  for (const lot of lots) {
    const key =
      lot.code && lot.address
        ? JSON.stringify([lot.source, lot.code, lot.name.trim(), lot.address.trim()])
        : JSON.stringify(['individual', lot.id])
    const group = groups.get(key) || []
    group.push(lot)
    groups.set(key, group)
  }
  const byIdentity = new Map<string, ParkingFacility[]>()
  const byName = new Map<string, ParkingFacility[]>()
  const byAddress = new Map<string, { facility: ParkingFacility; locations: ParkingLot[] }[]>()
  const facilities: ParkingFacility[] = []
  // Prefer the group with individual bay records when a summary overlaps it.
  const orderedGroups = [...groups.values()]
  for (const group of orderedGroups) group.sort((a, b) => a.id.localeCompare(b.id))
  orderedGroups.sort(
    (a, b) =>
      b.length - a.length ||
      Number(b[0].source === 'public') - Number(a[0].source === 'public') ||
      a[0].id.localeCompare(b[0].id),
  )
  for (const group of orderedGroups) {
    const located = group.filter((lot) => lot.lat !== null && lot.lng !== null)
    const first = group[0]
    const bays = group.length > 1 && group.every((lot) => lot.capacity === 1)
    const capacity = bays ? group.length : first.capacity
    const lat = located.length
      ? located.reduce((sum, lot) => sum + lot.lat!, 0) / located.length
      : null
    const lng = located.length
      ? located.reduce((sum, lot) => sum + lot.lng!, 0) / located.length
      : null
    const addressKey =
      first.code && first.address ? JSON.stringify([first.code, first.name, first.address]) : null
    // Compare the original bay coordinates before averaging them for the pin.
    const keys =
      first.code && first.source
        ? located.flatMap((lot) => [
            JSON.stringify([first.code, first.name, lot.lat, lot.lng]),
            ...(first.address && lot.capacity !== null
              ? [JSON.stringify([first.name, first.address, lot.capacity, lot.lat, lot.lng])]
              : []),
          ])
        : []
    const nameKey = first.name.replace(/\([시구]\)$/, '').replace(/\s/g, '').replace(/공영주차장$/, '')
    const sameRegistration = byName.get(nameKey)?.find((facility) => {
      if (
        !first.code ||
        !facility.code ||
        !first.source ||
        !facility.source ||
        capacity === null ||
        capacity !== facility.capacity ||
        lat === null ||
        lng === null ||
        facility.lat === null ||
        facility.lng === null
      )
        return false
      const distance = Math.hypot((lat - facility.lat) * 111_000, (lng - facility.lng) * 88_000)
      if (facility.source !== first.source) {
        const address = first.address?.replace(/^서울(?:특별시|시)\s+/, '')
        const otherAddress = facility.address?.replace(/^서울(?:특별시|시)\s+/, '')
        if (nameKey && address && address === otherAddress && distance <= 15) return true
        return distance <= 8 && (facility.code === first.code || (
          first.name === facility.name && !!(first.address && facility.address)
        ))
      }
      if (facility.code === first.code) return distance <= 1
      return !!first.address && first.address === facility.address && distance <= 3
    })
    const existing =
      keys
        .flatMap((key) => byIdentity.get(key) ?? [])
        .find((facility) => facility.source !== first.source) ??
      (addressKey ? byAddress.get(addressKey) : undefined)?.find(({ facility, locations }) => {
        if (facility.source === first.source) return false
        const sameCenter =
          lat !== null &&
          lng !== null &&
          facility.lat !== null &&
          facility.lng !== null &&
          Math.abs(lat - facility.lat) < 0.00001 &&
          Math.abs(lng - facility.lng) < 0.00001
        return (
          sameCenter ||
          located.some((lot) =>
            locations.some(
              (other) =>
                Math.hypot((lot.lat! - other.lat!) * 111_000, (lot.lng! - other.lng!) * 88_000) <=
                35,
            ),
          )
        )
      })?.facility ??
      sameRegistration
    if (existing) {
      existing.memberIds.push(...group.map((lot) => lot.id))
      continue
    }
    const facility: ParkingFacility = {
      ...group[0],
      lat,
      lng,
      capacity,
      available: bays
        ? group.every((lot) => lot.available !== null)
          ? group.reduce((sum, lot) => sum + lot.available!, 0)
          : null
        : group[0].available,
      memberIds: group.map((lot) => lot.id),
    }
    facilities.push(facility)
    const named = byName.get(nameKey) ?? []
    named.push(facility)
    byName.set(nameKey, named)
    if (addressKey) {
      const matches = byAddress.get(addressKey) ?? []
      matches.push({ facility, locations: located })
      byAddress.set(addressKey, matches)
    }
    for (const key of new Set(keys)) {
      const matches = byIdentity.get(key) ?? []
      matches.push(facility)
      byIdentity.set(key, matches)
    }
  }
  return facilities
}
