import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

// `extensions/` 는 CommonJS tsconfig 만 본다 — `import.meta.url` 을 쓰면 TS1343 으로 깨진다
const require_ = createRequire(__filename)
const { boardHtml, strataHtml, symbolList, escapeHtml, breakablePath, shortName } = require_('./core/render')
const { layerModel } = require_('./core/strata')

const graph = {
  nodes: [
    { path: 'a/domain/Center.java', lines: 42, symbols: [{ name: 'Foo', kind: 'class', line: 7 }] },
    { path: 'a/application/Svc.java', lines: 10, symbols: [] },
    { path: 'a/adapter/Jpa.java', lines: 10, symbols: [] },
  ],
  edges: [],
  kinEdges: [],
}
const model = layerModel(graph.nodes.map((n) => n.path))
const stats = { files: 3, symbols: 1, edges: 0, seconds: '0.12', failed: 0 }
const view = (over = {}) => ({
  center: 'a/domain/Center.java',
  inbound: [],
  outbound: [],
  blast: { rings: [], total: 0 },
  model,
  violations: [],
  ...over,
})

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

  /** 같은 이름이 여럿일 때 그것을 가르는 유일한 단서가 시그니처다 */
  it('시그니처가 있으면 함께 낸다', () => {
    const html = symbolList('a/X.java', [{ name: 'X', kind: 'constructor', line: 3, params: '(String a)' }])

    expect(html).toContain('(String a)')
    expect(html).toContain('k-constructor')
  })

  it('시그니처가 없으면 빈 칸을 만들지 않는다', () => {
    expect(symbolList('a/x.ts', [{ name: 'Foo', kind: 'class', line: 1 }])).not.toContain('class="params"')
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

describe('긴 경로', () => {
  /** 낱말 한가운데서 끊기면 경로를 눈으로 못 따라간다 — 접을 자리를 디렉토리 경계로 준다 */
  it('디렉토리 경계에서 접히게 표시한다', () => {
    expect(breakablePath('a/b/c.kt')).toBe('a/<wbr>b/<wbr>c.kt')
  })

  // `<wbr>` 을 넣느라 새김을 건너뛰면 경로가 태그가 된다
  it('접을 자리를 넣어도 새김은 그대로다', () => {
    expect(breakablePath('a/<b>/c.ts')).toBe('a/<wbr>&lt;b&gt;/<wbr>c.ts')
  })

  it('칸이 좁은 자리에는 확장자를 뗀 이름만 쓴다', () => {
    expect(shortName('a/b/Player.java')).toBe('Player')
  })
})

describe('단면도', () => {
  const empty = new Map<string, number>()

  /** 층 순서가 곧 주장이다 — 위가 바깥, 아래가 안쪽 */
  it('바깥 층을 먼저 그린다', () => {
    const html = strataHtml(graph.nodes, model, 'a/domain/Center.java', empty, new Set())

    expect(html.indexOf('adapter')).toBeLessThan(html.indexOf('application'))
    expect(html.indexOf('application')).toBeLessThan(html.indexOf('>domain<'))
  })

  it('고른 파일만 선택 표시를 단다', () => {
    const html = strataHtml(graph.nodes, model, 'a/domain/Center.java', empty, new Set())

    expect(html).toContain('class="cell sel"')
    expect(html.match(/class="cell sel"/g)).toHaveLength(1)
  })

  /** 촌수가 멀수록 옅어진다. 등급이 없으면 파문이 그냥 「물든 덩어리」가 된다 */
  it('촌수를 등급으로 나눈다', () => {
    const hops = new Map([['a/application/Svc.java', 1], ['a/adapter/Jpa.java', 3]])
    const html = strataHtml(graph.nodes, model, 'a/domain/Center.java', hops, new Set())

    expect(html).toContain('class="cell h1"')
    expect(html).toContain('class="cell h3"')
  })

  /** 아주 먼 것도 화면에서 사라지면 안 된다 — 가장 옅은 등급으로 몰아 넣는다 */
  it('아주 먼 촌수도 가장 옅은 등급으로 남긴다', () => {
    const hops = new Map([['a/adapter/Jpa.java', 9]])
    const html = strataHtml(graph.nodes, model, 'a/domain/Center.java', hops, new Set())

    expect(html).toContain('h4')
    expect(html).not.toContain('h9')
  })

  /**
   * **무엇을 골랐든 셀 자리는 안 바뀐다.**
   *
   * 한 번 촌수 순으로 정렬했다가 되돌렸다 — 고를 때마다 셀이 자리를 바꾸면 파문이
   * 「번지는」 것으로 안 보이고 화면이 통째로 갈아엎히는 것으로 보인다.
   *
   * ⚠️ **이 시험을 한 번 헛으로 썼다.** 처음 픽스처는 층마다 파일이 하나씩이라 정렬이
   * 일할 게 없었고, 촌수 순으로 되돌리는 변이를 넣어도 초록이었다. 정렬을 재려면
   * **한 층에 여럿**이 있어야 한다.
   */
  const crowd = [
    { path: 'a/domain/Alpha.java', lines: 1, symbols: [] },
    { path: 'a/domain/Beta.java', lines: 1, symbols: [] },
    { path: 'a/domain/Gamma.java', lines: 1, symbols: [] },
    { path: 'a/adapter/Jpa.java', lines: 1, symbols: [] },
  ]
  const crowdModel = layerModel(crowd.map((n) => n.path).concat('a/application/S.java'))
  // 반경은 Gamma > Beta > Alpha. 자리는 언제나 이 순서다
  const crowdBlasts = new Map([
    ['a/domain/Alpha.java', 1],
    ['a/domain/Beta.java', 5],
    ['a/domain/Gamma.java', 9],
    ['a/adapter/Jpa.java', 0],
  ])
  const order = (html: string) => (html.match(/data-arg="([^"]+)"/g) ?? []).join(' ')

  it('고른 파일이 달라져도 셀 순서가 그대로다', () => {
    const first = strataHtml(crowd, crowdModel, 'a/domain/Gamma.java', new Map(), new Set(), crowdBlasts)
    // Alpha 를 1촌으로 물들인다 — 촌수로 정렬하면 Alpha 가 맨 앞으로 튀어나온다
    const second = strataHtml(
      crowd,
      crowdModel,
      'a/adapter/Jpa.java',
      new Map([['a/domain/Alpha.java', 1]]),
      new Set(),
      crowdBlasts,
    )

    expect(order(first)).toContain('Gamma')
    expect(order(second)).toBe(order(first))
  })

  /** 반경이 큰 것이 층 안에서 앞에 온다 — 급소가 먼저 눈에 들어야 한다 */
  it('층 안에서 반경이 큰 것이 앞이다', () => {
    const html = strataHtml(crowd, crowdModel, '', new Map(), new Set(), crowdBlasts)

    expect(html.indexOf('Gamma')).toBeLessThan(html.indexOf('Beta'))
    expect(html.indexOf('Beta')).toBeLessThan(html.indexOf('Alpha'))
  })

  it('층을 어기며 가리킨 파일에 표시를 단다', () => {
    const targets = new Set(['a/adapter/Jpa.java'])
    const html = strataHtml(graph.nodes, model, 'a/application/Svc.java', empty, targets)

    expect(html).toContain(' vt"')
  })

  // 셀을 누르면 그 파일로 옮겨 간다. 인자는 **문자열 하나**뿐이다 (다리 규약)
  it('셀은 옮겨 가는 명령을 단다', () => {
    const html = strataHtml(graph.nodes, model, 'a/domain/Center.java', empty, new Set())

    expect(html).toContain('data-command="codeMap.focus"')
    expect(html).toContain('data-arg="a/adapter/Jpa.java"')
  })

  /** 안팎이 없는 프로젝트에서는 그 사실을 적는다 — 안 적으면 위반 0과 구분되지 않는다 */
  it('폴더 모드면 방향을 안 잰다고 적는다', () => {
    const flat = [{ path: 'src/a.ts', lines: 1, symbols: [] }, { path: 'electron/b.ts', lines: 1, symbols: [] }]
    const html = strataHtml(flat, layerModel(flat.map((n) => n.path)), 'src/a.ts', empty, new Set())

    expect(html).toContain('방향은 재지 않습니다')
  })
})

describe('보드', () => {
  it('규모를 함께 낸다', () => {
    const html = boardHtml(graph, view(), stats)

    expect(html).toContain('파일 3')
    expect(html).toContain('0.12초에 읽음')
  })

  it('반경을 파일 수와 비율로 낸다', () => {
    const html = boardHtml(graph, view({ blast: { rings: [['a/application/Svc.java']], total: 1 } }), stats)

    expect(html).toContain('/ 3개 파일에 닿습니다')
    expect(html).toContain('33%')
    expect(html).toContain('1촌 1')
  })

  /** 아무도 안 쓰는 파일에서 촌수 칸이 비면 화면이 깨진 줄로 읽힌다 */
  it('아무도 안 쓰면 그렇다고 말한다', () => {
    expect(boardHtml(graph, view(), stats)).toContain('아무도 쓰지 않습니다')
  })

  /** 위반은 **0일 때도** 적는다 — 안 적으면 「재지 않았다」와 구분되지 않는다 */
  it('층 위반이 없어도 0건이라고 적는다', () => {
    expect(boardHtml(graph, view(), stats)).toContain('층 위반 0건')
  })

  it('폴더 모드에서는 층 위반 줄을 아예 안 낸다', () => {
    const flat = { nodes: [{ path: 'src/a.ts', lines: 1, symbols: [] }], edges: [], kinEdges: [] }
    const flatModel = layerModel(['src/a.ts', 'electron/b.ts'])
    const html = boardHtml(flat, view({ center: 'src/a.ts', model: flatModel }), stats)

    expect(html).not.toContain('층 위반')
  })

  /** 못 읽은 파일을 조용히 넘기면 「이 프로젝트에는 원래 없다」로 읽힌다 */
  it('못 읽은 파일이 있으면 그 수를 말한다', () => {
    expect(boardHtml(graph, view(), { ...stats, failed: 6 })).toContain('읽지 못한 파일 6개')
  })

  it('다 읽었으면 그 줄을 안 낸다', () => {
    expect(boardHtml(graph, view(), stats)).not.toContain('읽지 못한 파일')
  })
})
