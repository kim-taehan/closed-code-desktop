import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

// 상세 — 화면의 숫자마다 달린 목록. `render.test.ts` 에서 갈라냈다 (저쪽이 300줄 상한을 넘었다).
//
// `extensions/` 는 CommonJS tsconfig 만 본다 — `import.meta.url` 을 쓰면 TS1343 으로 깨진다
const require_ = createRequire(__filename)
const { boardHtml, detailHtml } = require_('./core/render')
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

/**
 * **화면의 숫자마다 목록이 달려 있는가.**
 *
 * 「1촌 8」 이 여덟이 누구인지 말하지 않으면 그 숫자는 막다른 길이다. 재 놓고 들어갈 문을
 * 안 내면 사용자가 「상세는 어떻게 보나」를 묻게 된다 — 실제로 그렇게 물었다.
 */
describe('상세', () => {
  const withBlast = (over = {}) =>
    view({
      blast: { rings: [['a/application/Svc.java'], ['a/adapter/Jpa.java']], total: 2 },
      ...over,
    })

  it('촌수마다 그 파일들의 이름을 낸다', () => {
    const html = detailHtml(withBlast())

    expect(html).toContain('1촌 1')
    expect(html).toContain('2촌 1')
    expect(html).toContain('Svc')
    expect(html).toContain('Jpa')
  })

  /** 이름은 누를 수 있어야 한다 — 목록만 있고 못 가면 반쪽이다 */
  it('이름은 눌러서 옮겨 갈 수 있다', () => {
    const html = detailHtml(withBlast())

    expect(html).toContain('data-command="codeMap.focus"')
    expect(html).toContain('data-arg="a/application/Svc.java"')
  })

  it('아무도 안 쓰면 그렇다고 말한다', () => {
    expect(detailHtml(view())).toContain('아무도 이 파일을 쓰지 않습니다')
  })

  it('나가는 것이 없으면 그렇다고 말한다', () => {
    expect(detailHtml(view())).toContain('다른 파일을 쓰지 않습니다')
  })

  it('나가는 것을 중복 없이 낸다', () => {
    const html = detailHtml(view({ outbound: ['a/adapter/Jpa.java', 'a/adapter/Jpa.java'] }))

    expect(html.match(/data-arg="a\/adapter\/Jpa\.java"/g)).toHaveLength(1)
  })

  /** 어긴 쪽만 적으면 **무엇을 향해** 어겼는지가 빠진다 */
  it('층 위반은 양끝을 다 보여준다', () => {
    const html = detailHtml(
      view({ violations: [{ from: 'a/application/Svc.java', to: 'a/adapter/Jpa.java' }] }),
    )

    expect(html).toContain('층 위반 1건')
    expect(html).toContain('data-arg="a/application/Svc.java"')
    expect(html).toContain('data-arg="a/adapter/Jpa.java"')
    expect(html).toContain('ref bad')
  })

  it('폴더 모드에서는 위반 칸을 아예 안 낸다', () => {
    const flat = layerModel(['src/a.ts', 'electron/b.ts'])
    const html = detailHtml(
      view({ center: 'src/a.ts', model: flat, violations: [{ from: 'src/a.ts', to: 'electron/b.ts' }] }),
    )

    expect(html).not.toContain('층 위반')
  })

  it('보드가 상세를 함께 낸다', () => {
    expect(boardHtml(graph, withBlast(), stats)).toContain('이 파일을 고치면 닿는 것 2')
  })
})
