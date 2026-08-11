import type { RefObject } from 'react'
import { MessageList } from './MessageList'
import { LoadingIndicator } from './LoadingIndicator'
import { GestureTrail } from './GestureTrail'
import type { MouseGestureApi } from '../state/useMouseGesture'
import type { SessionSlice } from '../state/sessionSlice'
import type { ChatEditorContext } from '../state/editorContext'
import { sendReviewDecision } from '../state/activeReview'

// 대화 화면 — 본문 탭이 '대화'일 때 그려지는 것 전부 (배너·메시지·진행 표시).
//
// 세션 조각(slice)을 통째로 받는다 — 낱개로 풀면 prop 이 열 개를 넘고, 화면에 무엇이
// 필요한지가 App 쪽으로 새어 나간다.
//
// 이동 제스처(←·→)와 잔상은 대화에서도 받는다 — ㄴ 은 nav.closeActive 가 대화 탭에서
// no-op 이라 조용히 무시된다.

export interface ChatPaneProps {
  slice: SessionSlice
  gesture: MouseGestureApi
  scrollRef: RefObject<HTMLDivElement | null>
  /** 편집기 상태(활성 파일·선택·미저장). 여기서 나가는 요청에도 그대로 실린다. */
  chatContext: ChatEditorContext
  onOpenFile: (path: string, revealLine?: number) => void
}

export function ChatPane(props: ChatPaneProps) {
  const { snapshot, reviews, approvals, questions, plans, isStreaming, mode, activityKey } = props.slice
  // 인터럽트(승인·질문·계획)가 떠 있는가 — 진행 표시가 멈춘 것처럼 보이면 안 된다
  const waiting = (approvals[0] ?? questions[0] ?? plans[0] ?? null) !== null

  return (
    <div className="app-scroll" ref={props.scrollRef} {...props.gesture.handlers}>
      <GestureTrail gesture={props.gesture} />
      <MessageList
        messages={snapshot.messages}
        turnMetas={snapshot.turnMetas}
        isStreaming={isStreaming}
        agentTasks={snapshot.agentTasks}
        reviews={reviews.reviews}
        onOpenFile={props.onOpenFile}
        onAskShell={(command, output) =>
          void window.davis.sendChat({
            // 모델은 이 명령을 본 적이 없다 — 무엇을 돌렸는지부터 알려준다
            query: ['다음 명령을 실행했습니다.', '', `$ ${command}`, '', '```', output, '```'].join('\n'),
            ...props.chatContext,
          })
        }
        onDecideReview={sendReviewDecision}
      />
      <div className="chat-gutter">
        {/* 승인 대기 중에도 진행 표시를 유지한다 — 멈춘 것처럼 보이면 안 된다 */}
        <LoadingIndicator
          active={isStreaming || waiting}
          mode={waiting && mode === 'idle' ? 'tool-use' : mode}
          activityKey={activityKey}
        />
      </div>
    </div>
  )
}
