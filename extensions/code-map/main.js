const { GLOB, READS, languageOf } = require('./core/languages')
const { parseFile } = require('./core/parser')
const { extract } = require('./core/extract')
const { buildGraph, neighborhood, blastRadius } = require('./core/graph')
const { layerModel, violations } = require('./core/strata')
const { boardHtml, emptyHtml, FOCUS } = require('./core/render')

// 확장 「코드 지도」 — 프로젝트의 구조를 tree-sitter 로 읽어 **층 단면도**로 보여주고,
// 고른 파일이 흔드는 범위(영향 반경)를 그 위에 물들인다.
//
// 이 파일은 **배선만** 한다 (`screen-scenario` 와 같은 결). 판단은 `core/` 가 진다:
// 무엇이 심볼인가(extract) · 무엇이 간선인가(graph) · 무엇이 층인가(strata) ·
// 어떻게 보이는가(render).
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
  /** 층 판정과 위반. 지도를 만들 때 한 번만 재고 들고 있는다 — 그릴 때마다 다시 세지 않는다 */
  let model = null
  let broken = []
  /**
   * 경로 → 영향 반경. **지도를 만들 때 한 번만** 잰다.
   *
   * 반경 하나를 재는 데 간선을 전부 훑으므로, 정렬 비교자 안에서 부르면 O(N log N × E) 가
   * 된다 — 파일이 늘면 그리는 것보다 정렬이 오래 걸린다. 여기서 한 번 재 두고
   * 처음 열 자리 고르기와 셀 자리 고정에 함께 쓴다.
   */
  let blasts = new Map()

  async function draw() {
    if (!graph) {
      await code.view.setHtml(VIEW, emptyHtml(`아직 지도가 없습니다. 「지도 만들기」를 누르세요. (${READS} 를 읽습니다)`))
      return
    }
    // 볼 자리를 못 정했으면 **가장 크게 흔드는 파일**을 연다
    const center = focused ?? epicenter()
    const view = {
      ...neighborhood(graph, center),
      blast: blastRadius(graph, center),
      blasts,
      model,
      violations: broken,
    }
    await code.view.setHtml(VIEW, boardHtml(graph, view, stats))
  }

  /**
   * 처음 열 때 보여줄 파일. **가장 크게 흔드는 것**이다.
   *
   * > 전에는 **가장 많이 참조되는 것**을 열었다. 2026-08-30 에 반경으로 바꿨다 —
   * > 둘은 다른 값이고 순위가 실제로 뒤집힌다. langrisser 실측에서 참조 1위는 `Player`(22)
   * > 지만 반경 1위는 `LabeledEnum`(41, 참조로는 3위)이다. 「고치기 전에 무엇을 봐야 하나」에
   * > 답하는 것은 반경 쪽이다.
   *
   * ⚠️ **동점을 명시적으로 깬다.** 안 그러면 파일을 훑는 순서가 승자를 정하는데, 그건
   * 디렉토리 나열 순서라 판이 바뀌면 달라진다 — 같은 코드에서 다른 화면이 열린다.
   * 반경 → 심볼 수 → 경로 순으로 내려간다.
   */
  function epicenter() {
    const ranked = [...graph.nodes].sort(
      (a, b) =>
        (blasts.get(b.path) ?? 0) - (blasts.get(a.path) ?? 0) ||
        b.symbols.length - a.symbols.length ||
        a.path.localeCompare(b.path),
    )
    return ranked[0]?.path ?? ''
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
      code.progress(`읽을 파일이 없습니다 — 지금은 ${READS} 만 읽습니다`, undefined, undefined, { kind: 'fail' })
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
      const { symbols, imports, kin } = extract(tree.root, tree.languageId)
      parsed.push({ path, symbols, imports, kin, lines: text.split('\n').length })
      // 파일마다 보고하면 왕복이 파싱보다 비싸다. 50개마다 한 번.
      if (i % 50 === 0) code.progress('구조를 읽는 중', i, files.length)
    }

    graph = buildGraph(parsed)
    model = layerModel(graph.nodes.map((n) => n.path))
    broken = violations(graph, model)
    blasts = new Map(graph.nodes.map((n) => [n.path, blastRadius(graph, n.path).total]))
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

  /**
   * 겨누는 파일 경로를 꺼낸다.
   *
   * ⚠️ **부르는 자리가 둘이고 모양이 다르다** (실측):
   *   화면 다리(`data-arg`)      → 문자열 하나
   *   파일 트리 우클릭(`selection`) → 문자열 **배열** (`runCommand` 의 두 번째 인자)
   * 한쪽만 받으면 다른 쪽이 **예외 없이 조용히** 아무 일도 안 한다 — `onActiveFile` 이
   * 꼭 그 모양으로 죽어 있었다.
   */
  function targetPath(arg) {
    if (typeof arg === 'string') return arg
    if (Array.isArray(arg) && typeof arg[0] === 'string') return arg[0]
    return null
  }

  /** 화면에서 노드를 누르면 온다. **지도가 이미 있을 때만** 뜻이 있다 */
  async function focus(arg) {
    const path = targetPath(arg)
    if (!path || !graph) return
    if (!graph.nodes.some((n) => n.path === path)) return
    focused = path
    await draw()
  }

  /**
   * 프로젝트 트리에서 우클릭해 들어오는 길.
   *
   * `focus` 와 갈라 둔 까닭은 하나다 — **여기서는 지도가 아직 없을 수 있다.** 사용자는
   * 확장 패널을 연 적도 없이 파일을 우클릭했고, 그때 `focus` 를 부르면 조건에서 걸려
   * 아무 일도 안 일어난다. 없으면 먼저 만든다.
   */
  async function reveal(arg) {
    const path = targetPath(arg)
    if (!path) return
    if (!graph) await build()
    await focus(path)
  }

  return {
    commands: {
      'codeMap.open': draw,
      'codeMap.build': build,
      [FOCUS]: focus,
      'codeMap.reveal': reveal,
    },
    /** 앱이 다시 그리라고 할 때 (뷰가 새로 붙었을 때 등) */
    redraw: draw,
    /**
     * 편집기에서 파일을 옮기면 지도도 따라간다. **지도에 없는 파일이면 가만히 있는다** —
     * 화면이 갑자기 비면 사용자는 지도가 깨진 줄로 읽는다.
     */
    onActiveFile: async (file) => {
      // ⚠️ **인자는 문자열이 아니라 `{ path, line? }` 객체다** (`extensionLoader.ts` 의
      // `ActiveFileRef`). 여기서 문자열로 받고 `n.path === file` 을 재고 있었고, 그러면
      // 언제나 거짓이라 **예외도 없이 아무 일도 안 일어났다** — 조용히 죽은 배선이었다.
      const path = file && typeof file === 'object' ? file.path : null
      if (graph && path && graph.nodes.some((n) => n.path === path)) {
        focused = path
        await draw()
      }
    },
  }
}

module.exports = { activate }
