let pending: Promise<void> | undefined
export function loadKakaoSdk(key: string) {
  if (window.kakao?.maps?.Map) return Promise.resolve()
  pending ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    const timer = window.setTimeout(() => fail(), 15000)
    function fail() {
      window.clearTimeout(timer)
      script.remove()
      pending = undefined
      reject(
        new Error('카카오 지도를 불러오지 못했어요. JavaScript 키와 등록 도메인을 확인해 주세요.'),
      )
    }
    script.src =
      'https://dapi.kakao.com/v2/maps/sdk.js?autoload=false&libraries=clusterer&appkey=' +
      encodeURIComponent(key)
    script.onerror = fail
    script.onload = () => {
      if (!window.kakao?.maps) {
        fail()
        return
      }
      window.kakao.maps.load(() => {
        window.clearTimeout(timer)
        resolve()
      })
    }
    document.head.append(script)
  })
  return pending
}
