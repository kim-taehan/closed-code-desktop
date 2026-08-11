import type { PermissionMode } from '../../shared/protocol/kinds'
import type { WorkingDirState } from './workingDir'
import type { TurnReview } from '../../shared/protocol/turnReview'
import type {
  ChatSnapshotPayload,
  SessionStatePayload,
  TurnEvent,
} from '../../shared/ipc/channels'
import type { ChatHistoryState } from './chatHistory'
import type { McpState } from '../../shared/protocol/mcpConfig'
import type { LlmModelStatePayload } from '../../shared/protocol/llmConfig'
import type { UserNotification } from '../../shared/protocol/notification'

// ProjectSession 이 밖으로 내는 것들. **renderer 로 직접 보내지 않는다** —
// 자기 상태를 콜백으로 낼 뿐, 어디로 보낼지는 SessionBridge 가 정한다.

export interface ProjectSessionListener {
  onState(state: SessionStatePayload): void
  /** runtime 수명/설치 상태 (진행률 포함) */
  onTurnEvent(event: TurnEvent): void
  onSnapshot(snapshot: ChatSnapshotPayload): void
  onPermissionMode(mode: PermissionMode): void
  /** 현재 세션 작업 경로 (ADR-036) — override 가 걸리거나 풀릴 때 */
  onWorkingDir(state: WorkingDirState): void
  onHistoryState(state: ChatHistoryState): void
  onReviewState(reviews: TurnReview[]): void
  onMcpState(state: McpState): void
  /** 모델 스위처 상태 (llm_config status/models 결과) */
  onModelState(state: LlmModelStatePayload): void
  /** 내 작업 결과·배경 발견을 나에게만 알리는 push (ADR-053) */
  onNotification(notification: UserNotification): void
}
