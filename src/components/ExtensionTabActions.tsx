import type { ExtensionCommand } from '../../shared/extensions/manifest'

// **그 탭의 준비 행동** (`command.view` 로 뷰에 묶은 header 명령).
//
// `ExtensionViewPanel` 에서 갈라냈다 — 저쪽이 300줄 상한에 닿았다.
//
// 왜 탭 안인가: 패널 헤더의 한 자리는 **확장 전체**에 걸린다. 탭마다 하는 일이 다르면
// 그 자리가 거짓말을 한다 — 「전체 파일 보기」는 화면에만 뜻이 있는데 API 탭을 보는
// 중에도 떠 있었고, 「목록 갱신」은 어느 쪽을 갱신하는지 화면이 말해 주지 않았다.
// 탭 바로 아래에 두면 **옆의 탭 이름이 무엇을 갱신하는지 말해 준다.**
//
// 스크롤 칸 **밖**에 산다 (`ExtensionViewPanel` 의 `ext-view__scroll`) — 긴 트리에서
// 스크롤에 밀려 사라지면 안 되는 버튼이다.

export interface ExtensionTabActionsProps {
  /** 지금 보는 탭에 묶인 것만. 비면 아무것도 안 그린다 (`viewCommands`) */
  commands: ExtensionCommand[]
  /** 지금 도는 명령 id 들 */
  running: string[]
  onRun: (commandId: string) => void
}

export function ExtensionTabActions(props: ExtensionTabActionsProps) {
  // **줄 자체를 안 그린다.** 빈 줄을 남기면 뷰마다 탭 아래 여백이 달라져 탭을 옮길 때
  // 트리가 위아래로 튄다 (아래 고정 바와 달리 여긴 지킬 높이가 없다).
  if (props.commands.length === 0) return null

  return (
    <div className="ext-view__acts">
      {props.commands.map((command) => (
        <button
          key={command.id}
          type="button"
          className="ext-view__act"
          // 도는 동안 잠근다 — 갱신을 두 번 걸면 어시스턴트를 두 벌 부른다
          disabled={props.running.includes(command.id)}
          onClick={() => props.onRun(command.id)}
        >
          {command.title}
        </button>
      ))}
    </div>
  )
}
