import type { ReactNode } from 'react'
import type { ChatMessage, TurnMeta } from '../../shared/ipc/messageTypes'
import { errorTone } from '../../shared/protocol/errorMessages'
import { MessageKind } from '../../shared/ipc/messageTypes'
import type { TurnEntry } from '../state/turnGrouping'
import { buildTurnNodes, isRenderableNode, type TurnNode } from '../state/turnNodes'
import { extractReply, isTurnInterrupted } from '../state/replyExtraction'
import { railEdgeFor } from '../state/railEdge'
import { TurnContainer } from './TurnContainer'
import { TazArea } from './TazArea'
import { AssistantMessage } from './AssistantMessage'
import { ThinkingBlock } from './ThinkingBlock'
import { AskAboutShell, TurnFooter } from './TurnExtras'
import { TurnReviewPanel } from './TurnReviewPanel'
import type { TurnReview } from '../../shared/protocol/turnReview'
import { activeReviewOf } from '../state/activeReview'
import type { AgentTask } from '../../shared/ipc/agentTask'
import { AgentTaskCard } from './AgentTaskCard'

// **턴 하나를 그린다.** `MessageList` 에서 갈라져 나왔다 (2026-08-17) — 그 파일이 300줄
// 상한에 붙어 있었고, 갈린 자리가 곧 책임의 경계다: 저쪽은 **무엇을 그릴지 고르고**
// (그룹핑 결과를 훑어 턴이냐 단일 메시지냐), 이쪽은 **턴 하나를 어떻게 그릴지** 만 안다.
//
// 줄 수를 벌려고 옮긴 것이 아니다 — 이 레포는 그 거래를 거절해 왔다. 여기 든 것은
// 「중단된 턴의 답변 자리」·「스트리밍 대상 하나」·「리뷰 카드 잇기」처럼 **턴 안에서만
// 뜻이 있는 규칙들**이고, 목록을 읽으러 온 사람에게는 전부 잡음이었다.
//
// 순수 함수(그룹핑·노드 분할·reply 추출)는 여전히 `src/state` 가 한다. 이 파일도
// 그 결과를 컴포넌트로 옮기기만 한다.

export function TurnEntryView({
  entry,
  meta,
  isStreaming,
  agentTasks,
  reviews,
  onDecideReview,
  onOpenFile,
  onAskShell,
  onFeedback,
}: {
  entry: TurnEntry
  meta: TurnMeta | undefined
  isStreaming: boolean
  agentTasks: AgentTask[]
  reviews: TurnReview[]
  onDecideReview?: (turnId: string, decision: 'accept' | 'reject', filePaths?: string[]) => void
  /** 턴 리뷰의 파일 경로를 눌렀을 때 그 파일을 첫 변경 지점에서 연다. 없으면 경로가 눌리지 않는다. */
  onOpenFile?: (path: string, revealLine?: number) => void
  /** 로컬 셸 결과를 대화에 넘긴다. `note` 는 사용자가 덧붙인 한 줄. 없으면 버튼을 그리지 않는다. */
  onAskShell?: (command: string, output: string, note?: string) => void
  onFeedback?: (messageContent: string) => void
}) {
  const interrupted = isTurnInterrupted(entry.messages)
  const reply = extractReply(entry.messages, {
    turnEnded: entry.turnEnded,
    turnInterrupted: interrupted,
  })

  const nodes = buildTurnNodes(entry.messages).filter(isRenderableNode)

  // 그릴 게 하나도 없으면 헤더도 그리지 않는다 (설계 §5.2, MessageList.tsx:460-461).
  // 빈 텍스트만 온 턴에 헤더만 덩그러니 남으면 유령 턴처럼 보인다.
  if (nodes.length === 0) return null

  /*
   * 중단된 턴 레이아웃 예외 (설계 §6.4).
   * 렌더 노드가 하나뿐이면 body 를 비우고 그 노드를 답변 자리에 둔다 —
   * 그래야 스텝 0 이 되어 "펼칠 것도 없는데 확장기만 있는" 헤더가 생기지 않는다.
   * 둘 이상이면 전부 body 로 보내고 답변은 뽑지 않는다.
   */
  const replyIndex = interrupted
    ? nodes.length <= 1
      ? 0
      : -1
    : reply
      ? nodes.findIndex((node) => node.kind === 'item' && node.msg.id === reply.id)
      : -1

  // 스트리밍 대상은 정확히 하나다: 마지막 그룹의 마지막 텍스트 버블
  const streamingTargetId =
    isStreaming && entry.isLastGroup && !entry.turnEnded ? lastTextId(entry.messages) : null

  const context: RenderContext = {
    nodes,
    streamingTargetId,
    turnInterrupted: interrupted,
    ...(onAskShell ? { onAskShell } : {}),
  }

  // 이 턴에 붙는 리뷰. chatTurnId 로 잇고, 마지막 리뷰만 조작 가능하다.
  const review = entry.turnId
    ? reviews.find((candidate) => candidate.chatTurnId === entry.turnId)
    : undefined
  const reviewSlot =
    review && onDecideReview ? (
      <TurnReviewPanel
        review={review}
        // 조작 가능한 카드는 하나뿐이다 — 그 판정은 단축키와 함께 activeReview.ts 가 쥔다
        actionsDisabled={review !== activeReviewOf(reviews)?.review}
        onDecide={onDecideReview}
        {...(onOpenFile ? { onOpenFile } : {})}
      />
    ) : null

  const body: ReactNode[] = []
  nodes.forEach((node, index) => {
    if (index === replyIndex) return
    body.push(renderNode(node, index, `body-${index}`, context))
  })

  // 서브에이전트 작업은 **그 작업을 띄운 턴에만** 붙인다.
  // 전부 붙이면 모든 턴에 같은 카드가 중복으로 나온다.
  for (const task of agentTasks) {
    if (task.turnId !== entry.turnId) continue
    body.push(<AgentTaskCard key={`task-${task.taskId}`} task={task} />)
  }

  return (
    <TurnContainer
      {...(entry.turnId !== undefined ? { turnId: entry.turnId } : {})}
      body={body}
      {...(replyIndex >= 0
        ? { reply: renderNode(nodes[replyIndex]!, replyIndex, 'reply', context) }
        : {})}
      {...(meta?.durationMs !== undefined ? { durationMs: meta.durationMs } : {})}
      {...(meta?.startedAt !== undefined ? { startedAt: meta.startedAt } : {})}
      isStreaming={isStreaming && entry.isLastGroup && !entry.turnEnded}
      terminal={entry.turnEnded}
      interrupted={interrupted}
      // 5번 자리 — 턴 리뷰 카드
      {...(reviewSlot ? { reviewSlot } : {})}
      // 토큰 줄은 답변이 있고 턴이 끝났을 때만 나온다 (설계 §6.1)
      {...(reply && entry.turnEnded
        ? {
            tokenSlot: (
              <TurnFooter
                tokens={meta?.tokens}
                {...(onFeedback ? { onFeedback: () => onFeedback(reply.content) } : {})}
              />
            ),
          }
        : {})}
    />
  )
}

interface RenderContext {
  nodes: TurnNode[]
  streamingTargetId: string | null
  turnInterrupted: boolean
  onAskShell?: (command: string, output: string, note?: string) => void
}

function renderNode(node: TurnNode, index: number, key: string, context: RenderContext): ReactNode {
  const railEnd = railEdgeFor(context.nodes, index) === 'end'

  if (node.kind === 'tools') {
    const next = context.nodes[index + 1]
    return (
      <TazArea
        key={key}
        tools={node.tools}
        argsOf={(message) => message.toolArgs}
        collapseWhenFollowedByNonTool={next !== undefined && next.kind !== 'tools'}
        railEnd={railEnd}
      />
    )
  }

  const { msg } = node
  if (msg.kind === MessageKind.THINKING) {
    return <ThinkingBlock key={key} content={msg.content} railEnd={railEnd} />
  }

  if (msg.kind === MessageKind.ERROR) {
    return (
      <div key={key} className={`${errorTone(msg.severity)}${railEnd ? ' cc-rail-end' : ''}`}>
        {msg.content}
      </div>
    )
  }

  return (
    <div key={key}>
      <AssistantMessage
        message={msg}
        isStreamingTarget={context.streamingTargetId === msg.id}
        railEnd={railEnd}
        hideInterruptedLabel={context.turnInterrupted}
      />

      {/* 로컬 셸 결과는 runtime 이 모른다 — 이어서 물으려면 여기서 넘겨야 한다 */}
      {msg.shell && <AskAboutShell shell={msg.shell} onAsk={context.onAskShell} />}
    </div>
  )
}

/** 내용이 있는 마지막 텍스트 메시지의 id */
function lastTextId(messages: ChatMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    if (message.kind === MessageKind.TEXT && message.content.trim()) return message.id
  }
  return null
}
