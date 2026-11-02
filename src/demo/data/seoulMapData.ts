let promise:
  Promise<{ roads: unknown[]; parking: unknown[]; population: { features: unknown[] } }> | undefined
export function loadSeoulMapData() {
  promise ??= fetch(`${import.meta.env.BASE_URL}data/seoul-map.json`)
    .then(async (response) => {
      if (!response.ok) throw new Error('지도 자료를 불러오지 못했어요.')
      const data = await response.json()
      if (!data || !Array.isArray(data.roads) || !Array.isArray(data.population?.features))
        throw new Error('지도 자료 형식이 올바르지 않습니다.')
      return { ...data, parking: Array.isArray(data.parking) ? data.parking : [] }
    })
    .catch((error) => {
      promise = undefined
      throw error
    })
  return promise
}
