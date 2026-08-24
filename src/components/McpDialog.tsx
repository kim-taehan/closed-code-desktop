import type { McpState } from '../../shared/protocol/mcpConfig'
import { McpSection } from './McpSection'

// 커넥터(MCP) 팝업 — 입력창 +버튼의 "커넥터" 에서 연다.
// 설정창에서 떼어내 여기로 옮겼다 (설정은 연결·화면·업데이트·단축키만).
// 설정 모달 스타일을 그대로 쓴다.

export interface McpDialogProps {
  state: McpState
  onClose: () => void
}

export function McpDialog({ state, onClose }: McpDialogProps) {
  return (
    <div className="dc-modal" role="dialog" aria-label="커넥터" onClick={onClose}>
      <div className="dc-settings" onClick={(event) => event.stopPropagation()}>
        <div className="dc-settings__head">
          <span className="dc-settings__title">커넥터 (MCP)</span>
          <button type="button" className="dc-modal__close" onClick={onClose} title="닫기">
            ×
          </button>
        </div>
        {/* **`dc-settings__body` 를 쓰지 않는다.** 그것은 `180px 1fr` 격자라 자식이 하나면
            그 하나가 180px 칸에 들어간다 — 커넥터가 딱 그 꼴이었다: 좁은 왼쪽 열에 카드가
            전부 몰려 도구 칩이 잘리고 오른쪽은 통째로 비었다. 여기 두 칸은 `McpSection` 이
            직접 나눈다 (`dc-mcp-split`). 창틀만 설정 모달에서 빌린다. */}
        <div className="dc-mcp-body">
          <McpSection state={state} />
        </div>
      </div>
    </div>
  )
}
