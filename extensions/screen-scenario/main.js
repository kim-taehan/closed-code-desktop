const store = require('./core/store')
const { boardHtml } = require('./core/render/list')
const { parseScreens, parseCases } = require('./core/parse')
const { mergeScreens } = require('./core/merge')
const { findPrompt, refindPrompt, writePrompt } = require('./core/prompt')
const { scenariosMarkdown } = require('./core/render/markdown')

// 확장 4호 「화면 시나리오」 — 설계:
// `docs/superpowers/specs/2026-08-13-screen-scenario-extension-design.md`
//
// 이 파일은 **배선만** 한다: 명령을 등록하고, 저장된 것을 그리고, 다시 그리라는 요청을 받는다.
// 판단(무엇이 화면인가·시나리오를 어떻게 쓰는가)은 `core/` 가 진다.
//
// 에이전트에게 묻는 길은 `code.chat.ask` 하나다 — 그 질문은 **사용자 대화의 턴**이 되어
// 화면에 그대로 보인다 (설계 §3.1). 그래서 진행 상황을 따로 중계하지 않는다.

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

  /**
   * 화면 찾기. 에이전트에게 묻고 답을 목록으로 얹는다.
   *
   * **규칙 훑기 뒷문을 만들지 않는다** (설계 §3.1). 두 갈래가 있으면 지금 보는 목록을
   * 누가 만들었는지 알 수 없고, 한쪽이 조용히 망가져도 다른 쪽이 채워 준다.
   */
  async function find() {
    const before = await store.load(code)
    code.progress('화면을 찾는 중입니다…')

    const answer = await code.chat.ask(before.length === 0 ? findPrompt() : refindPrompt(before))

    if (answer.status === 'cancelled') {
      // 사용자가 대화창에서 끊었다. 실패가 아니다 — 있던 목록은 그대로다.
      code.progress('화면 찾기를 멈췄습니다', undefined, undefined, { kind: 'note' })
      return
    }
    if (answer.status !== 'done') {
      code.progress(`화면을 찾지 못했습니다: ${answer.reason}`, undefined, undefined, { kind: 'fail' })
      return
    }

    const read = parseScreens(answer.text)
    if (!read.ok) {
      // **빈 목록으로 삼키지 않는다.** 답은 대화창에 그대로 있으니 그리로 안내한다.
      code.progress(`목록을 못 읽었습니다 (${read.reason}) — 대화창의 답을 보세요`, undefined, undefined, {
        kind: 'fail',
      })
      return
    }

    const merged = mergeScreens(before, read.screens)
    await store.save(code, merged.screens)
    await draw()

    if (merged.distrusted) {
      // 지우지 않았다는 것을 말해 준다. 조용히 넘기면 사용자는 갱신이 먹은 줄 안다.
      code.progress(
        `새로 ${merged.added}개. 사라졌다는 화면이 너무 많아 지우지 않았습니다 — 다시 눌러 보세요`,
        undefined,
        undefined,
        { kind: 'fail' },
      )
      return
    }
    code.progress(`화면 ${merged.screens.length}개 (새로 ${merged.added} · 사라짐 ${merged.removed})`, undefined, undefined, {
      kind: 'done',
    })
  }

  /**
   * 화면 하나의 시나리오를 쓴다. **한 번에 한 턴이다.**
   *
   * @returns 계속해도 되는가 — 사용자가 끊었으면 `false` 이고, 부르는 쪽은 거기서 멈춘다.
   *   확장이 남은 것을 계속 보내면, 끊은 사람이 대화창에서 같은 질문을 또 보게 된다.
   */
  async function writeOne(screen, at, total) {
    code.progress(`${screen.name} 시나리오를 쓰는 중입니다…`, at, total)
    const answer = await code.chat.ask(writePrompt(screen))

    if (answer.status === 'cancelled') {
      // **거기까지 만든 것은 남는다** — 앞 화면들은 이미 저장했다 (설계 §3.3)
      code.progress('멈췄습니다. 여기까지 만든 것은 남아 있습니다', undefined, undefined, { kind: 'note' })
      return false
    }
    if (answer.status !== 'done') {
      code.progress(`${screen.name}: ${answer.reason}`, undefined, undefined, { kind: 'fail' })
      return true
    }

    const read = parseCases(answer.text)
    if (!read.ok) {
      code.progress(`${screen.name}: 시나리오를 못 읽었습니다 (${read.reason}) — 대화창의 답을 보세요`, undefined, undefined, {
        kind: 'fail',
      })
      return true
    }

    // **한 화면씩 저장한다.** 전부 끝나고 한 번에 쓰면 도중에 끊긴 것이 통째로 사라진다.
    const screens = await store.load(code)
    await store.save(
      code,
      screens.map((one) =>
        one.id === screen.id ? { ...one, cases: read.cases, state: store.DRAFT } : one,
      ),
    )
    await draw()
    code.progress(`${screen.name} — 케이스 ${read.cases.length}`, at + 1, total, { kind: 'done' })
    return true
  }

  /** 고른 화면 하나 (`data-arg` 로 온다). 없으면 아무것도 안 한다. */
  async function write(target) {
    const screens = await store.load(code)
    const screen = screens.find((one) => one.id === target)
    if (screen === undefined) return
    await writeOne(screen, 0, 1)
  }

  /**
   * 아직 없는 것만 만든다. **이미 있는 것은 건드리지 않는다** — 「전체」가 사람이 확정해 둔
   * 시나리오까지 갈아치우면 한 번의 오조작으로 전부 날아간다. 다시 만들려면 하나씩 누른다.
   */
  async function writeMissing() {
    const screens = await store.load(code)
    const todo = screens.filter((one) => one.cases.length === 0)
    if (todo.length === 0) {
      code.progress('시나리오가 없는 화면이 없습니다', undefined, undefined, { kind: 'note' })
      return
    }
    for (let at = 0; at < todo.length; at += 1) {
      // 큐를 확장이 쥔다 — `chat.ask` 는 사용자 큐를 타지만 **여러 화면을 한꺼번에 밀면**
      // 대화창이 질문으로 가득 찬다. 앞이 끝나야 다음을 보낸다.
      const go = await writeOne(todo[at], at, todo.length)
      if (!go) return
    }
  }

  /**
   * 지금 목록 전부를 마크다운 한 장으로 내보낸다.
   *
   * **취소는 실패가 아니다** — 사용자가 저장 창을 닫으면 `null` 이 오고, 그때 오류를 띄우면
   * 「안 했다」가 「못 했다」로 보인다 (`code.export.save` 계약).
   */
  async function exportMarkdown() {
    const screens = await store.load(code)
    const saved = await code.export.save('화면-시나리오.md', scenariosMarkdown(screens, today()))
    if (saved === null) return
    code.progress(`저장했습니다: ${saved}`, undefined, undefined, { kind: 'done' })
  }

  /** 상태를 사람이 올리고 내린다. 확정은 「내가 읽어 봤다」는 뜻이라 사람만 건다. */
  async function setState(target, next) {
    const screens = await store.load(code)
    await store.save(
      code,
      screens.map((one) => (one.id === target ? { ...one, state: next } : one)),
    )
    await draw()
  }

  return {
    commands: {
      // 주 행동 — 사이드바 아래 고정 바에 뜬다. 누르면 본문 탭이 앞으로 온다
      'screenScenario.open': () => draw(),
      'screenScenario.find': () => find(),
      'screenScenario.add': () => add(),
      // 아래 셋은 **화면 안에서** 걸린다. 겨누는 대상은 `data-arg` → `selection[0]` 로 온다
      'screenScenario.write': (selection) => write(first(selection)),
      'screenScenario.writeMissing': () => writeMissing(),
      'screenScenario.fix': (selection) => setState(first(selection), store.FIXED),
      'screenScenario.unfix': (selection) => setState(first(selection), store.DRAFT),
      'screenScenario.export': () => exportMarkdown(),
    },
    // 화면이 붙은 뒤 앱이 부른다 (`METHOD_REDRAW`). 프로젝트를 옮겨도 여기로 다시 온다
    redraw: () => draw(),
  }
}

/** 문서 머리에 적을 날짜. 시험은 이 값을 안 본다 (매일 달라진다). */
function today() {
  return new Date().toISOString().slice(0, 10)
}

/** `selection` 은 배열로 온다 (호스트 계약). 우리 화면은 늘 하나만 싣는다. */
function first(selection) {
  return Array.isArray(selection) && typeof selection[0] === 'string' ? selection[0] : ''
}

module.exports = { activate }
