import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

// `extensions/` 는 CommonJS tsconfig 만 본다 — `import.meta.url` 을 쓰면 TS1343 으로 깨진다
const require_ = createRequire(__filename)
const { boardHtml, graphSvg, symbolList, escapeHtml, MAX_SIDE } = require_('./core/render')

const graph = {
  nodes: [{ path: 'a/center.ts', lines: 42, symbols: [{ name: 'Foo', kind: 'class', line: 7 }] }],
  edges: [],
}
const stats = { files: 3, symbols: 1, edges: 0, seconds: '0.12', failed: 0 }

describe('심볼 줄', () => {
  /**
   * 클릭은 앱의 다리 규약으로만 나간다 — `data-open` + `data-line`
   * (`src/state/extensionHtmlDoc.ts` 의 BRIDGE). 이 속성 이름이 틀리면 **아무 일도
   * 안 일어난다** — 오류가 아니라 무반응이라 원인을 찾기 어렵다.
   */
  it('파일과 줄을 다리 규약대로 싣는다', () => {
    const html = symbolList('a/x.ts', [{ name: 'run', kind: 'function', line: 12 }])

    expect(html).toContain('data-open="a/x.ts"')
    expect(html).toContain('data-line="12"')
  })

  it('심볼이 없으면 빈 목록 대신 그렇다고 말한다', () => {
    expect(symbolList('a/x.ts', [])).toContain('심볼이 없습니다')
  })
})

describe('글자 새김', () => {
  // 파일 이름과 심볼 이름은 **프로젝트에서 온 값**이다. 그대로 끼우면 화면이 깨진다
  it('꺾쇠와 따옴표를 새긴다', () => {
    expect(escapeHtml('<img src=x onerror="y">')).toBe('&lt;img src=x onerror=&quot;y&quot;&gt;')
  })

  it('심볼 이름에 든 꺾쇠가 태그가 되지 않는다', () => {
    const html = symbolList('a/x.ts', [{ name: 'Map<string>', kind: 'class', line: 1 }])

    expect(html).toContain('Map&lt;string&gt;')
    expect(html).not.toContain('<string>')
  })
})

describe('이웃 그래프', () => {
  const many = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `a/${prefix}${i}.ts`)

  it('가운데와 양옆을 그린다', () => {
    const svg = graphSvg({ center: 'a/center.ts', inbound: ['a/in.ts'], outbound: ['a/out.ts'] })

    expect(svg).toContain('center.ts')
    expect(svg).toContain('in.ts')
    expect(svg).toContain('out.ts')
  })

  // 옆 노드를 누르면 그 파일로 옮겨 간다. 인자는 **문자열 하나**뿐이다 (다리 규약)
  it('옆 노드는 옮겨 가는 명령을 단다', () => {
    const svg = graphSvg({ center: 'a/center.ts', inbound: [], outbound: ['a/out.ts'] })

    expect(svg).toContain('data-command="codeMap.focus"')
    expect(svg).toContain('data-arg="a/out.ts"')
  })

  /** 가운데 것은 이미 보고 있으므로 옮겨 갈 곳이 아니다 */
  it('가운데 노드에는 옮기기를 안 단다', () => {
    const svg = graphSvg({ center: 'a/center.ts', inbound: [], outbound: [] })

    expect(svg).not.toContain('data-arg="a/center.ts"')
  })

  /**
   * **자른 것을 숨기지 않는다.**
   *
   * 이 워크스페이스의 `transport.ts` 는 나가는 간선이 16개다. 앞의 몇 개만 그리면서
   * 그 사실을 안 적으면 화면이 「이게 전부」라고 주장하게 된다.
   */
  it('넘치면 몇 개를 뺐는지 적는다', () => {
    const svg = graphSvg({ center: 'a/c.ts', inbound: [], outbound: many(MAX_SIDE + 4, 'o') })

    expect(svg).toContain('+4개 더')
  })

  it('딱 맞으면 아무 말도 안 한다', () => {
    const svg = graphSvg({ center: 'a/c.ts', inbound: [], outbound: many(MAX_SIDE, 'o') })

    expect(svg).not.toContain('개 더')
  })
})

describe('보드', () => {
  it('규모를 함께 낸다', () => {
    const html = boardHtml(graph, { center: 'a/center.ts', inbound: [], outbound: [] }, stats)

    expect(html).toContain('파일 3')
    expect(html).toContain('0.12초에 읽음')
  })

  /** 못 읽은 파일을 조용히 넘기면 「이 프로젝트에는 원래 없다」로 읽힌다 */
  it('못 읽은 파일이 있으면 그 수를 말한다', () => {
    const html = boardHtml(graph, { center: 'a/center.ts', inbound: [], outbound: [] }, { ...stats, failed: 6 })

    expect(html).toContain('읽지 못한 파일 6개')
  })

  it('다 읽었으면 그 줄을 안 낸다', () => {
    const html = boardHtml(graph, { center: 'a/center.ts', inbound: [], outbound: [] }, stats)

    expect(html).not.toContain('읽지 못한 파일')
  })
})
