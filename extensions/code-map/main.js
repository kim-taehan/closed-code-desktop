const { GLOB, languageOf } = require('./core/languages')
const { parseFile } = require('./core/parser')
const { extract } = require('./core/extract')
const { buildGraph, neighborhood } = require('./core/graph')
const { boardHtml, emptyHtml, FOCUS } = require('./core/render')

// 확장 「코드 지도」 — 프로젝트의 구조를 tree-sitter 로 읽어 이웃 그래프로 보여준다.
//
// 이 파일은 **배선만** 한다 (`screen-scenario` 와 같은 결). 판단은 `core/` 가 진다:
// 무엇이 심볼인가(extract) · 무엇이 간선인가(graph) · 어떻게 보이는가(render).
//
// **모델을 부르지 않는다.** 화면의 모든 것이 구문 분석에서 나오므로 같은 코드면 언제나
// 같은 결과다. 요약을 붙이는 것은 `chat.ask` 로 할 수 있지만, 파일마다 부르면 그 질의가
// 전부 사용자 대화의 턴이 되고 한 번에 하나씩만 돈다 — 1,002번은 쓸 수 없는 값이라
// v1 에서 뺐다. 붙인다면 「열어 본 파일만」처럼 수를 줄이는 규칙이 먼저 필요하다.

const VIEW = 'codeMap.board'

/** 안 읽는 곳. `listFiles` 가 `.git`·`node_modules` 는 이미 감춰 준다 */
const EXCLUDED = /(^|\/)(vendor|dist|dist-electron|build|release|out)(\/|$)/

function activate(code) {
  /** 마지막으로 만든 지도. **저장하지 않는다** — 1초면 다시 만드는데 8MB 상한을 쓸 이유가 없다 */
  let graph = null
  let stats = null
  let focused = null

  async function draw() {
    if (!graph) {
      await code.view.setHtml(VIEW, emptyHtml('아직 지도가 없습니다. 「지도 만들기」를 누르세요.'))
      return
    }
    // 볼 자리를 못 정했으면 **가장 많이 참조되는 파일**을 연다 — 프로젝트의 중심일 가능성이 높다
    const center = focused ?? busiest()
    await code.view.setHtml(VIEW, boardHtml(graph, neighborhood(graph, center), stats))
  }

  function busiest() {
    const inbound = new Map()
    for (const edge of graph.edges) inbound.set(edge.to, (inbound.get(edge.to) ?? 0) + 1)
    let best = graph.nodes[0]?.path ?? ''
    let most = -1
    for (const [path, count] of inbound) {
      if (count > most) { most = count; best = path }
    }
    return best
  }

  /**
   * 지도 만들기.
   *
   * 진행률을 **파일 수로** 보고한다. 1,002개에 1초 남짓이라 사실 눈에 안 띄지만,
   * 큰 레포에서는 어디까지 갔는지가 유일한 단서다.
   */
  async function build() {
    const files = (await code.workspace.listFiles(GLOB)).filter((p) => !EXCLUDED.test(p))
    if (files.length === 0) {
      code.progress('읽을 TypeScript·Kotlin 파일이 없습니다', undefined, undefined, { kind: 'fail' })
      return
    }

    const started = Date.now()
    const parsed = []
    let failed = 0
    for (let i = 0; i < files.length; i += 1) {
      const path = files[i]
      if (!languageOf(path)) continue
      let text
      try {
        text = await code.workspace.readFile(path)
      } catch {
        // 못 읽는 파일 하나가 지도 전체를 막지 않는다 (크기 상한·바이너리)
        failed += 1
        continue
      }
      const tree = await parseFile(path, text)
      if (!tree) continue
      if (tree.hasError) failed += 1
      const { symbols, imports } = extract(tree.root, tree.languageId)
      parsed.push({ path, symbols, imports, lines: text.split('\n').length })
      // 파일마다 보고하면 왕복이 파싱보다 비싸다. 50개마다 한 번.
      if (i % 50 === 0) code.progress('구조를 읽는 중', i, files.length)
    }

    graph = buildGraph(parsed)
    stats = {
      files: parsed.length,
      symbols: parsed.reduce((n, f) => n + f.symbols.length, 0),
      edges: graph.edges.length,
      seconds: ((Date.now() - started) / 1000).toFixed(2),
      failed,
    }
    focused = null
    code.progress(`지도를 만들었습니다 — 파일 ${stats.files} · 심볼 ${stats.symbols}`, undefined, undefined, { kind: 'done' })
    await draw()
  }

  /** 화면에서 노드를 누르면 온다. **인자는 문자열 하나**뿐이다 (앱의 다리 규약) */
  async function focus(path) {
    if (typeof path !== 'string' || !graph) return
    if (!graph.nodes.some((n) => n.path === path)) return
    focused = path
    await draw()
  }

  return {
    commands: {
      'codeMap.open': draw,
      'codeMap.build': build,
      [FOCUS]: focus,
    },
    /** 앱이 다시 그리라고 할 때 (뷰가 새로 붙었을 때 등) */
    redraw: draw,
    /**
     * 편집기에서 파일을 옮기면 지도도 따라간다. **지도에 없는 파일이면 가만히 있는다** —
     * 화면이 갑자기 비면 사용자는 지도가 깨진 줄로 읽는다.
     */
    onActiveFile: async (path) => {
      if (graph && path && graph.nodes.some((n) => n.path === path)) {
        focused = path
        await draw()
      }
    },
  }
}

module.exports = { activate }
