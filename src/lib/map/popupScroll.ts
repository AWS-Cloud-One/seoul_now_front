/** Preserve native popup scrolling, but keep trackpad/wheel input out of the map SDK. */
export function isolatePopupScroll(element: HTMLElement) {
  const stop = (event: WheelEvent) => event.stopPropagation()
  element.addEventListener('wheel', stop, { passive: true })
  return () => element.removeEventListener('wheel', stop)
}
