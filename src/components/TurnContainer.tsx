import type { ReactNode } from 'react'
import { TurnHeader, useAutoCollapse } from './TurnHeader'

// 턴 하나의 배치 (설계 §6.1).
//
// 순서가 계약이다:
//   1. 헤더
//   2. 접히는 body — stepCount > 0 일 때만 존재한다
//   3. reply — body **바깥**, body 뒤. 그래야 단계가 접혀도 답변이 보인다
//   4. interrupted 라벨
//   5. 변경 사항(diff) 박스 자리 — M1 비목표라 비어 있지만 자리는 지킨다
//   6. 토큰 줄 — 맨 마지막

export interface TurnContainerProps {
  turnId?: string
  /** 접히는 body 에 들어갈 노드들 */
  body: ReactNode[]
  /** body 바깥에 남는 답변 */
  reply?: ReactNode
  durationMs?: number
  startedAt?: number
  isStreaming: boolean
  terminal: boolean
  interrupted?: boolean
  /** 5번 자리 — diff 리뷰 박스 (M3) */
  reviewSlot?: ReactNode
  /** 6번 자리 — 토큰 줄 */
  tokenSlot?: ReactNode
}

export function TurnContainer({
  turnId,
  body,
  reply,
  durationMs,
  startedAt,
  isStreaming,
  terminal,
  interrupted = false,
  reviewSlot,
  tokenSlot,
}: TurnContainerProps) {
  // 중단된 턴은 종료된 턴과 동일하게 취급한다 — 접히고, 틱이 멈추고, 클릭 가능해진다
  const effectiveTerminal = terminal || interrupted
  const effectiveStreaming = isStreaming && !interrupted

  const { expanded, toggle } = useAutoCollapse(effectiveStreaming, effectiveTerminal)
  const stepCount = body.length

  return (
    <>
      <TurnHeader
        {...(turnId !== undefined ? { turnId } : {})}
        stepCount={stepCount}
        {...(durationMs !== undefined ? { durationMs } : {})}
        {...(startedAt !== undefined ? { startedAt } : {})}
        isStreaming={effectiveStreaming}
        terminal={effectiveTerminal}
        expanded={expanded}
        onToggle={toggle}
      />

      {/* stepCount 가 0 이면 body 요소 자체를 만들지 않는다 */}
      {stepCount > 0 && (
        <div
          className={`cc-turn-body${expanded ? ' cc-turn-body--expanded' : ''}`}
          aria-hidden={!expanded}
        >
          <div className="cc-turn-body-inner">{body}</div>
        </div>
      )}

      {reply}

      {interrupted && (
        <div className="cc-interrupted-label cc-turn-interrupted-label">interrupted</div>
      )}

      {reviewSlot}
      {tokenSlot}
    </>
  )
}
