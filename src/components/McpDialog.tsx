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
        <div className="dc-settings__body">
          <div className="dc-settings__pane">
            <McpSection state={state} />
          </div>
        </div>
      </div>
    </div>
  )
}
