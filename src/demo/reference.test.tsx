/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import DemoProvider from './DemoProvider'
import { StartScreen } from './components/Screens'
import ConceptMap from './components/ConceptMap'
import Icon from './components/Icon'

const original = readFileSync(resolve('public/demo/original.html'), 'utf8')
const originalScript = [...original.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].at(-1)![1]
beforeEach(() => {
  sessionStorage.clear()
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

type Shape = string | { tag: string; attributes: Record<string, string>; children: Shape[] }
function shape(node: Node): Shape | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent?.replace(/\s+/g, ' ').trim()
    return text || null
  }
  if (!(node instanceof Element)) return null
  node.normalize()
  const attributes = Object.fromEntries(
    [...node.attributes]
      .filter((a) => !['src', 'srcset'].includes(a.name))
      .map((a) => [
        a.name,
        (a.name === 'style'
          ? a.value.replace(/\s*:\s*/g, ':').replace(/\s*;\s*/g, ';')
          : a.value
        ).replace(/;$/, ''),
      ])
      .sort(([a], [b]) => a.localeCompare(b)),
  )
  return {
    tag: node.tagName,
    attributes,
    children: [...node.childNodes].map(shape).filter((n): n is Shape => n !== null),
  }
}
function parse(html: string) {
  const container = document.createElement('div')
  container.innerHTML = html
  return container
}

it('첫 화면의 문구·DOM 구조·아이콘을 원본 HTML과 동일하게 렌더링한다', () => {
  const start = original.slice(
    original.indexOf('<section id="start-screen"'),
    original.indexOf('<a class="skip"'),
  )
  const expected = parse(start).querySelector('#start-screen')!
  const actual = render(
    <DemoProvider>
      <StartScreen />
    </DemoProvider>,
  ).container.querySelector('#start-screen')!
  expect(shape(actual)).toEqual(shape(expected))
  // The original reference embeds both images; verify the externalized files byte for byte.
  const desktop = expected.querySelector('img')!.getAttribute('src')!
  const portrait = expected.querySelector('source')!.getAttribute('srcset')!
  const digest = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')
  expect(digest(readFileSync(resolve('public/images/seoul-wide.png')))).toBe(
    digest(Buffer.from(desktop.split(',')[1], 'base64')),
  )
  expect(digest(readFileSync(resolve('public/images/seoul-portrait.png')))).toBe(
    digest(Buffer.from(portrait.split(',')[1], 'base64')),
  )
})

it('지도 미리보기의 모든 SVG 좌표·색상·문구·버튼 구조를 원본과 동일하게 렌더링한다', () => {
  const locations = originalScript.slice(
    originalScript.indexOf('const CONCEPT_LOCATIONS='),
    originalScript.indexOf('function conceptMapHTML'),
  )
  const concept = originalScript.slice(
    originalScript.indexOf('function conceptMapHTML'),
    originalScript.indexOf('let conceptMapController'),
  )
  // Run only the reference's pure SVG renderer, never the original application's DOM/event code.
  const reference = new Function(
    `const ui={layers:{roads:true,parking:true,population:true}};${locations}${concept};return conceptMapHTML();`,
  )() as string
  const expected = parse(reference).querySelector('svg')!
  const actual = render(
    <DemoProvider>
      <ConceptMap />
    </DemoProvider>,
  ).container.querySelector('svg')!
  expect(shape(actual)).toEqual(shape(expected))
})

it('공통 아이콘의 CSS 클래스·선 두께·SVG 도형을 원본과 동일하게 유지한다', () => {
  const renderer = originalScript.slice(
    originalScript.indexOf('const icon='),
    originalScript.indexOf('const PURPOSES'),
  )
  for (const name of ['chat', 'map', 'people', 'car', 'arrow']) {
    const expected = parse(
      new Function(`${renderer};return icon(${JSON.stringify(name)});`)() as string,
    ).querySelector('svg')!
    const view = render(<Icon name={name} />)
    expect(shape(view.container.querySelector('svg')!)).toEqual(shape(expected))
    view.unmount()
  }
})

it('21개 스타일시트의 내용과 적용 순서 및 폰트 데이터를 원본대로 유지한다', () => {
  const styles = [...original.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(
    (match) => match[1],
  )
  expect(styles).toHaveLength(21)
  const normalize = (value: string) => value.replace(/\r\n/g, '\n')
  const hash = (value: string) => createHash('sha256').update(normalize(value)).digest('hex')
  styles.forEach((css, i) => {
    let expected = css
    if (i === 14)
      expected = expected.replace(
        /url\((['"]?)data:font\/woff2;base64,([A-Za-z0-9+/=]+)\1\)/g,
        (_, _quote, base64: string) => {
          expect(
            createHash('sha256')
              .update(readFileSync(resolve('src/demo/assets/suit-variable.woff2')))
              .digest('hex'),
          ).toBe(createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex'))
          return "url('../assets/suit-variable.woff2')"
        },
      )
    if (i === 18) expected = expected.replace('body > :is', 'body #root > :is')
    if (i === 20)
      expected = expected.replace('body.landing-active>:not', 'body.landing-active #root>:not')
    const filename = `${String(i + 1).padStart(2, '0')}.css`
    expect(hash(readFileSync(resolve('src/demo/styles', filename), 'utf8')), filename).toBe(
      hash(expected),
    )
  })
  const order = [
    ...readFileSync(resolve('src/demo/styles/index.css'), 'utf8').matchAll(
      /@import '\.\/(\d+)\.css'/g,
    ),
  ].map((match) => Number(match[1]))
  expect(order).toEqual(Array.from({ length: 21 }, (_, i) => i + 1))
})
