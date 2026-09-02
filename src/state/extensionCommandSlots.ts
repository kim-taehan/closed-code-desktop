import type { ExtensionCommand } from '../../shared/extensions/manifest'
import type { ExtensionEntryPayload } from '../../shared/ipc/extensionPayloads'

// 확장이 선언한 명령을 **자리 셋**으로 나눈다 (기획서 §3).
//
// 예전에는 전부 같은 크기 알약으로 한 줄에 늘어섰다. 「목록 갱신」(준비)·「시나리오
// 작성」(주 행동)·「MD 내보내기」(마무리)가 구분되지 않아 **무엇을 먼저 눌러야 하는지
// 화면이 말해 주지 않았다.** 게다가 그 줄이 탭보다 위에 있어 어느 탭에 거는 명령인지도
// 모호했다.
//
// 나누는 규칙은 매니페스트의 `placement` 다. **안 적으면 주 행동**이라, 명령이 하나뿐인
// 확장(`program-map`·`line-checker`)은 아무것도 안 고쳐도 아래 바의 큰 버튼을 얻는다.

export interface CommandSlots {
  /**
   * 패널 헤더 오른쪽에 작게. 준비 행동.
   *
   * **뷰를 적은 것은 여기 없다** (`command.view`). 그런 것은 그 뷰의 탭 안으로 가고,
   * 꺼내는 자리는 `viewCommands` 다 — 탭마다 하는 일이 다르면 헤더의 한 자리가
   * 거짓말을 한다 (「전체 파일 보기」가 화면에만 뜻이 있는데 API 탭에서도 떠 있었다).
   */
  header: ExtensionCommand[]
  /**
   * 아래 고정 바의 **큰 버튼 하나**. 없을 수도 있다 (전부 header·menu 로 선언한 확장).
   *
   * 여럿이 주 행동을 자처하면 **첫 번째만** 크게 둔다 — 큰 버튼이 둘이면 그 순간
   * 「무엇을 먼저 누르나」가 다시 사라진다. 나머지는 `⋯` 로 내린다.
   */
  primary: ExtensionCommand | null
  /** `⋯` 안. 마무리·드문 것, 그리고 주 행동 자리를 못 얻은 나머지 */
  menu: ExtensionCommand[]
}

/**
 * 그 탭 안에 그릴 준비 행동들. 뷰를 적지 않은 header 명령은 여기 안 온다 (헤더에 남는다).
 *
 * 선언 순서를 지킨다 — 개발자가 쓴 순서로 보여야 한다 (`menu` 와 같은 규칙).
 */
export function viewCommands(commands: readonly ExtensionCommand[], viewId: string): ExtensionCommand[] {
  return commands.filter((one) => one.placement === 'header' && one.view === viewId)
}

/**
 * 파일 트리 우클릭 메뉴에 낼 것들.
 *
 * **`commandSlots` 와 달리 확장 하나가 아니라 설치된 전부에서 걷는다** — 이 메뉴는
 * 프로젝트 탭에 살고, 사용자는 그때 어느 확장 패널도 안 보고 있을 수 있다. 「보던 파일에서
 * 확장을 부른다」가 이 자리의 뜻이라, 확장을 먼저 골라야 뜨면 그 뜻이 사라진다.
 *
 * 선언 순서를 지킨다 (`menu` 와 같은 규칙).
 */
export function fileCommands(
  extensions: readonly ExtensionEntryPayload[],
): { extension: string; command: ExtensionCommand }[] {
  return extensions.flatMap((one) =>
    (one.contributes?.commands ?? [])
      .filter((command) => command.placement === 'file')
      .map((command) => ({ extension: one.name, command })),
  )
}

export function commandSlots(commands: readonly ExtensionCommand[]): CommandSlots {
  const header = commands.filter((one) => one.placement === 'header' && one.view === undefined)
  const menu = commands.filter((one) => one.placement === 'menu')
  const rest = commands.filter((one) => one.placement === undefined)

  return {
    header,
    primary: rest[0] ?? null,
    // 선언 순서를 지킨다 — 개발자가 `⋯` 를 열었을 때 자기가 쓴 순서로 보여야 한다
    menu: commands.filter((one) => menu.includes(one) || rest.slice(1).includes(one)),
  }
}
