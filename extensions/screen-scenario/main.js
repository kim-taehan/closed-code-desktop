const store = require('./core/store')
const { boardHtml } = require('./core/render/list')

// 확장 4호 「화면 시나리오」 — 설계:
// `docs/superpowers/specs/2026-08-13-screen-scenario-extension-design.md`
//
// 이 파일은 **배선만** 한다: 명령을 등록하고, 저장된 것을 그리고, 다시 그리라는 요청을 받는다.
// 판단(무엇이 화면인가·시나리오를 어떻게 쓰는가)은 `core/` 가 진다.
//
// 3단계에서는 **에이전트를 부르지 않는다.** 저장된 것을 그리는 길을 먼저 세워야,
// 다음 단계에서 화면이 비었을 때 그것이 「에이전트 답」 탓인지 「그리기」 탓인지 갈린다.

const VIEW = 'screenScenario.board'

/**
 * 화면으로 볼 만한 파일. **여기서 화면을 판정하지 않는다** — 「화면 더하기」가 사람에게
 * 보여줄 후보를 좁히는 그물일 뿐이고, 무엇이 화면인지는 사람이 고른다.
 */
const CANDIDATES = '**/*.{tsx,jsx,vue,html}'

function activate(code) {
  // 지금 고른 화면. **저장하지 않는다** — 앱을 다시 켰을 때 첫 화면부터 보는 것이 맞고,
  // 저장하면 지운 화면을 가리킨 채로 살아남는다.
  let selected = null

  async function draw() {
    const screens = await store.load(code)
    if (selected !== null && !screens.some((one) => one.id === selected)) selected = null
    await code.view.setHtml(VIEW, boardHtml(screens, selected))
  }

  /**
   * 화면 더하기. `listFiles` 로 후보를 받아 사람에게 고르게 한다.
   *
   * 고르개를 우리가 그리지 않고 `ui.askText` 로 받는다 — 확장이 사람에게 값을 받는 길은
   * 그것뿐이다(설계 §3, 창은 앱이 그린다). 후보를 미리 보여 주고 경로를 붙여 넣게 한다.
   */
  async function add() {
    const files = await code.workspace.listFiles(CANDIDATES)
    if (files.length === 0) {
      code.progress('화면으로 볼 만한 파일이 없습니다', undefined, undefined, { kind: 'fail' })
      return
    }

    const typed = await code.ui.askText({
      title: '화면 더하기 — 프로젝트 안 경로',
      // 사람이 아는 것은 파일 이름이고, 목록은 수백 줄일 수 있다. 앞 몇 개만 보기로 준다.
      hint: `예: ${files.slice(0, 3).join(' · ')}`,
    })
    // **취소는 실패가 아니다** — 창을 닫으면 `null` 이고 아무 일도 안 일어난다
    if (typed === null) return

    const path = typed.trim()
    if (path === '') return
    if (!files.includes(path)) {
      // 있는 파일만 넣는다. 오타를 그대로 담으면 목록에 열리지 않는 줄이 남는다.
      code.progress(`그런 파일이 없습니다: ${path}`, undefined, undefined, { kind: 'fail' })
      return
    }

    const screens = await store.load(code)
    const next = store.withScreen(screens, store.screenOfPath(path, store.MANUAL))
    if (next === screens) {
      code.progress('이미 목록에 있습니다', undefined, undefined, { kind: 'note' })
      return
    }
    await store.save(code, next)
    selected = path
    await draw()
  }

  return {
    commands: {
      // 주 행동 — 사이드바 아래 고정 바에 뜬다. 누르면 본문 탭이 앞으로 온다
      'screenScenario.open': () => draw(),
      'screenScenario.find': async () => {
        // 4단계에서 `code.chat.ask` 로 채운다. 지금 조용히 아무 일도 안 하면
        // 사용자에게는 「단추가 안 먹는다」로 보인다.
        code.progress('화면 찾기는 아직 준비 중입니다', undefined, undefined, { kind: 'note' })
      },
      'screenScenario.add': () => add(),
    },
    // 화면이 붙은 뒤 앱이 부른다 (`METHOD_REDRAW`). 프로젝트를 옮겨도 여기로 다시 온다
    redraw: () => draw(),
  }
}

module.exports = { activate }
