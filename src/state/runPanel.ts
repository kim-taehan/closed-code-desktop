import type { RunEntry } from '../../shared/run/runSection'

// 사이드바 「실행」 패널의 **판정과 문구** (설계 2026-08-16 §1·§2).
//
// 컴포넌트 밖에 있는 이유는 `drawerTabs.ts`·`drawerKeys.ts` 와 같다: 이름이 붙을 만한
// 판단이고, 훅 안에 두면 렌더 없이 시험할 수 없다. **경계도 여기서 갈린다** — main 은
// 프로세스를 조작하고 "우리 것인가" 만 답한다 (설계 §5 「경계」).

/** 줄 앞의 점. 초록(돌고 있음) · 빨강(오류) · 회색(멈춤) */
export type RunState = 'running' | 'error' | 'idle'

/**
 * 그 줄이 지금 어떤 상태인가.
 *
 * 순서가 중요하다 — **끝났는지를 먼저 본다.** 프로세스가 죽어도 탭은 화면에 남으므로
 * (`DrawerTerminal` 이 "[셸이 끝났습니다]" 를 찍고 그대로 있다), 탭이 있다는 것만 보면
 * 죽은 개발 서버가 초록 점으로 남는다.
 *
 * `exit` 이 `undefined` 면 **끝난 적이 없다는 뜻이 아니라 우리가 못 봤다는 뜻**이다.
 * 종료 신호는 앱이 살아 있는 동안만 모인다 (`usePaneExits`).
 *
 * `exit` 이 `null` 은 **종료 코드를 못 읽은 것**이다 (pty 가 이미 사라진 경우 — 실측
 * `ptyPool.reportExit`). 오류로 칠하지 않는다: 실패했다는 증거가 없는데 빨간 점을 켜면
 * 사용자는 있지도 않은 문제를 찾는다.
 */
export function runState(
  name: string,
  openPanes: readonly string[],
  exit: number | null | undefined,
): RunState {
  if (exit !== undefined) return exit === null || exit === 0 ? 'idle' : 'error'
  return openPanes.includes(name) ? 'running' : 'idle'
}

/**
 * 이름 오른쪽에 적는 한 줄.
 *
 * ⚠️ **로그에서 알아낸 것은 아직 아무것도 없다.** 설계 §1 의 그림에는 `:5173` 이 있지만
 * 그것은 §7 미결 1(주소 알아채기)이라 이번 회차에 없다 — 여기서 지어내면 화면이
 * 있지도 않은 배선을 주장하게 된다. 지금 우리가 아는 사실은 **종료 코드** 하나다.
 */
export function runStateLabel(state: RunState, exit: number | null | undefined): string {
  if (state === 'running') return '도는 중'
  if (state === 'error') return `실패 · exit ${exit}`
  return ''
}

/**
 * 목록의 출처 한 줄. **목록이 틀렸을 때 사용자가 갈 곳을 안다** (설계 §1).
 *
 * 「없다」와 「비어 있다」를 가른다: 절이 없으면 우리가 아직 안 물어본 것이고, 절이 있는데
 * 비었으면 모델이 물어본 뒤 아무것도 못 찾은 것이다. 사용자가 다음에 할 일이 서로 다르다.
 */
export function runSourceLine(found: boolean, count: number): string {
  if (!found) return 'AGENTS.md 에 「실행」 절이 없습니다'
  if (count === 0) return 'AGENTS.md 의 「실행」 절이 비어 있습니다'
  return 'AGENTS.md 의 「실행」 절에서 읽었습니다'
}

/**
 * 모델에게 보내는 부탁. **입력창에 친 것과 같은 큐로 들어간다** (`sendUserText`).
 *
 * 도구 이름을 문장에 박아 둔다 — 이 부탁이 성립하는 조건이 그 도구의 존재이고,
 * 모델이 자기 편집 도구로 AGENTS.md 를 고치면 형식이 어긋나 패널이 그 목록을 못 읽는다
 * (`electron/mcp/saveRunCommands.ts` 머리말).
 *
 * **아무것도 실행하지 말라고 못 박는다.** 실행 방법을 묻는 말은 모델에게 "돌려 봐라" 로도
 * 읽힌다 — 개발 서버가 사용자 모르게 뜨면 포트를 물고 있는 이유를 아무도 모른다.
 */
export const ASK_PROMPT =
  '이 프로젝트를 어떻게 실행하는지 알아봐 주세요. package.json 의 scripts · gradle 태스크 · Makefile · docker-compose · README 를 직접 읽고 정하세요 — 이름만 보고 짐작하지 마세요. 사람이 누를 만한 것(개발 서버 · 테스트 · 빌드)만 골라 save_run_commands 도구로 AGENTS.md 의 「실행」 절에 적어 주세요. **아무것도 실행하지 마세요.**'

/** 매니페스트가 바뀐 뒤의 부탁. 지금 목록을 함께 실어 무엇이 달라졌는지 보게 한다. */
export function recheckPrompt(entries: readonly RunEntry[]): string {
  const current = entries.map((entry) => `${entry.name}: \`${entry.command}\``).join(' · ')
  return `${ASK_PROMPT}\n\n지금 AGENTS.md 에 적혀 있는 것은 ${current} 입니다. 매니페스트가 바뀌었으니 아직 맞는지 확인하고, 달라졌으면 고쳐 적어 주세요.`
}
