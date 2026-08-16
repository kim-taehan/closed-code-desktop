import { CONTROL_CHARS } from './openTerminal'
import { SHELL_PANE } from '../pty/ptyPool'

// run_project 도구가 받은 인자를 검사한다. `openTerminal.ts` 와 짝이고, 갈리는 지점이
// 하나다 — **여기서는 실제로 돌아간다.** 그래서 검사도 뜻이 다르다: 저쪽은 "사용자가 보기
// 전에 실행되어 버리지 않는가" 를 보고, 이쪽은 "무엇이 어디서 도는지가 우리가 말한 것과
// 같은가" 를 본다.
//
// ⚠️ **무엇을 실행할지는 여기서 인자로 받는다.** 처음에는 "AGENTS.md 에서 읽는 길이 아직
// 없다" 고 적혀 있었고, 이제 그 길이 생겼다 — 다만 **`run_project` 는 여전히 인자를 받는다.**
// 두 길이 갈리는 자리다: AGENTS.md 의 「실행」 절은 **사람이 사이드바에서 ▶ 를 누를 때**의
// 목록이고(`shared/run/runSection.ts`), 모델은 거기 없는 것도 돌릴 수 있어야 한다.
// 그 목록에 적는 일은 `save_run_commands` 가 따로 맡는다.

/** 이름 하나가 곧 칸 하나이고 pty 하나다. 사람이 탭에서 보는 글자이기도 하다. */
const NAME = /^[\w가-힣][\w가-힣 .-]{0,31}$/

export interface RunProjectInput {
  name: string
  command: string
}

export function runProjectInput(args: Record<string, unknown>): RunProjectInput {
  const name = asString(args['name'], 'name')
  const command = asString(args['command'], 'command')
  assertPaneName(name)
  assertCommandLine(command)
  return { name, command }
}

/**
 * 칸 이름이 쓸 만한가. **`save_run_commands` 도 이걸 쓴다** — AGENTS.md 에 적힌 이름이
 * 곧 ▶ 를 눌렀을 때의 칸 이름이라, 규칙이 두 벌이면 표에서는 받아 놓고 실행에서 거절한다.
 */
export function assertPaneName(name: string): void {
  if (!NAME.test(name)) {
    throw new Error(
      'name 은 32자 이내의 짧은 이름이어야 합니다 (예: dev · test · build) — 화면의 탭 이름이 되고 그대로 pty 제목이 됩니다',
    )
  }
  // **셸 칸에는 안 돌린다.** 거기는 사용자가 손으로 쓰는 자리라, 밀어 넣으면 사용자가
  // 치던 줄에 섞이고 안 끝나는 프로세스면 칸을 통째로 잠근다 — 다중화가 없앤 바로 그
  // 문제를 다시 만든다. 사용자에게 명령을 보여 주려는 것이면 `open_terminal` 이다.
  if (name === SHELL_PANE || name.startsWith(`${SHELL_PANE}-`)) {
    throw new Error(
      `\`${name}\` 은 사용자의 셸 칸 이름이라 쓸 수 없습니다. 하는 일이 드러나는 이름(dev · test 등)으로 다시 부르세요.`,
    )
  }
}

/**
 * 명령 한 줄인가. 제어문자는 `open_terminal` 과 같은 이유로 막는다(실측 근거는 그쪽 머리말).
 * 다만 뜻이 다르다: 여기서는 개행이 **명령을 여럿으로 쪼개고**, 그러면 우리가 "이것을
 * 띄웠다" 고 돌려준 문장과 실제로 돈 것이 달라진다.
 *
 * AGENTS.md 에 적을 때도 같은 검사를 탄다 — 개행이 든 명령은 표 한 칸에 안 들어간다
 * (`shared/run/runSection.ts`).
 */
export function assertCommandLine(command: string): void {
  if (CONTROL_CHARS.test(command)) {
    throw new Error(
      '명령에 개행이나 제어문자를 넣을 수 없습니다 — 여러 개를 이어 돌리려면 `&&` 로 한 줄에 쓰세요.',
    )
  }
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} 이(가) 없습니다`)
  }
  return value.trim()
}
