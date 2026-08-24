import type { ChatMessage, TurnMeta } from '../../shared/ipc/messageTypes'
import { MessageKind } from '../../shared/ipc/messageTypes'
import { groupMessages } from '../state/turnGrouping'
import { TurnEntryView } from './TurnEntryView'
import type { TurnReview } from '../../shared/protocol/turnReview'
import type { AgentTask } from '../../shared/ipc/agentTask'
import { formatBytes } from './AttachmentChips'

// 메시지 목록. 그룹핑·노드 분할·reply 추출은 전부 src/state 의 순수 함수가 한다.
// 여기서는 그 결과를 컴포넌트로 옮기기만 한다 (SRP).

export interface MessageListProps {
  messages: ChatMessage[]
  turnMetas: TurnMeta[]
  isStreaming: boolean
  /** 서브에이전트 작업. 주 대화에 섞이지 않고 턴 body 끝에 붙는다 */
  agentTasks?: AgentTask[]
  /** 턴 리뷰 카드 (V2). 턴의 5번 자리에 들어간다 */
  reviews?: TurnReview[]
  onDecideReview?: (turnId: string, decision: 'accept' | 'reject', filePaths?: string[]) => void
  /** 턴 리뷰의 파일 경로를 눌렀을 때 그 파일을 첫 변경 지점에서 연다. 없으면 경로가 눌리지 않는다. */
  onOpenFile?: (path: string, revealLine?: number) => void
  /** 로컬 셸 결과를 대화에 넘긴다. `note` 는 사용자가 덧붙인 한 줄. 없으면 버튼을 그리지 않는다. */
  onAskShell?: (command: string, output: string, note?: string) => void
  /** 이 답변에 대한 피드백을 연다. 어떤 응답이 문제였는지 함께 보낸다. */
  onFeedback?: (messageContent: string) => void
}

export function MessageList({
  messages,
  turnMetas,
  isStreaming,
  agentTasks = [],
  reviews = [],
  onDecideReview,
  onOpenFile,
  onAskShell,
  onFeedback,
}: MessageListProps) {
  const metaMap = new Map(turnMetas.map((meta) => [meta.turnId, meta]))
  const entries = groupMessages(messages, metaMap)

  return (
    <div className="chat-messages">
      {entries.map((entry, index) =>
        entry.kind === 'single' ? (
          entry.msg.kind === MessageKind.SYSTEM ? (
            <SystemDivider key={entry.msg.id} content={entry.msg.content} />
          ) : (
            <UserMessage key={entry.msg.id} message={entry.msg} />
          )
        ) : (
          <TurnEntryView
            key={entry.turnId ?? `legacy-${index}`}
            entry={entry}
            meta={entry.turnId ? metaMap.get(entry.turnId) : undefined}
            isStreaming={isStreaming}
            agentTasks={agentTasks}
            reviews={reviews}
            {...(onDecideReview ? { onDecideReview } : {})}
            {...(onOpenFile ? { onOpenFile } : {})}
            {...(onAskShell ? { onAskShell } : {})}
            {...(onFeedback ? { onFeedback } : {})}
          />
        ),
      )}
    </div>
  )
}


/**
 * 시스템 안내 구분선 (모델 변경 등, DC-1322). 턴 사이에 가운데 정렬로 긋는다.
 * 스타일은 인라인 — 메시지 스타일 구역(chat.css)은 다른 작업이 쥐고 있어 건드리지 않는다.
 */
function SystemDivider({ content }: { content: string }) {
  const line = { flex: 1, borderTop: '1px solid currentColor', opacity: 0.3 } as const
  return (
    <div
      role="status"
      style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0', fontSize: 12, opacity: 0.75 }}
    >
      <span style={line} />
      <span>{content}</span>
      <span style={line} />
    </div>
  )
}

function UserMessage({ message }: { message: ChatMessage }) {
  // 사용자 메시지는 마크다운으로 파싱하지 않는다 (설계 §6.8)
  return (
    <div className="cc-user-message">
      <div className="cc-user-text">{message.content}</div>

      {/* 무엇을 붙여 보냈는지 남긴다 — 이력을 다시 봤을 때 맥락이 사라지지 않게.
          내용은 담지 않는다 (이름·크기만) */}
      {message.attachments && message.attachments.length > 0 && (
        <div className="cc-user-attachments">
          {message.attachments.map((item, index) => (
            <span key={`${item.name}-${index}`} className="cc-user-attachment">
              {item.kind === 'image' ? '🖼' : '📄'} {item.name}
              {item.bytes !== undefined && ` · ${formatBytes(item.bytes)}`}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
