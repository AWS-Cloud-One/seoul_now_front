/** Validate new region variants while accepting stored V1-shaped administrative scopes. */
export function validRegion(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const r = value as Record<string, unknown>
  const ids = (v: unknown) => Array.isArray(v) && v.every((id) => typeof id === 'string' && !!id)
  if (typeof r.label !== 'string' || !r.label || !ids(r.area_ids)) return false
  if (!r.kind || r.kind === 'administrative')
    return (r.area_ids as string[]).length > 0 && !r.anchor && r.radius_m == null
  if ((r.area_ids as string[]).length) return false
  if (r.kind === 'official') {
    const versions = r.boundary_versions as Record<string, unknown> | undefined
    return (
      r.source === 'citydata_place_boundaries' &&
      ids(r.boundary_ids) &&
      (r.boundary_ids as string[]).length > 0 &&
      !!versions &&
      (r.boundary_ids as string[]).every((id) => typeof versions[id] === 'string') &&
      !r.anchor &&
      r.radius_m == null
    )
  }
  if (r.kind !== 'radius' || r.source !== 'kakao_local') return false
  const a = r.anchor as Record<string, unknown> | undefined
  const c = a?.coordinates as Record<string, unknown> | undefined
  return (
    !!a &&
    typeof a.place_id === 'string' &&
    typeof a.name === 'string' &&
    typeof a.collected_at === 'string' &&
    Number.isFinite(Date.parse(a.collected_at)) &&
    !!c &&
    typeof c.latitude === 'number' &&
    c.latitude >= -90 &&
    c.latitude <= 90 &&
    typeof c.longitude === 'number' &&
    c.longitude >= -180 &&
    c.longitude <= 180 &&
    typeof r.radius_m === 'number' &&
    Number.isInteger(r.radius_m) &&
    r.radius_m >= 100 &&
    r.radius_m <= 5000
  )
}

/** Search areas occur in snapshots, published results and history responses. */
export function validRegionPayload(value: unknown): boolean {
  if (!value || typeof value !== 'object') return true
  if (Array.isArray(value)) return value.every(validRegionPayload)
  return Object.entries(value).every(([key, item]) =>
    key === 'search_area' ? item == null || validRegion(item) : validRegionPayload(item),
  )
}
