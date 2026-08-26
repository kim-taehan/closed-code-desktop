import type { RefObject } from 'react'
import { MessageList } from './MessageList'
import { LoadingIndicator } from './LoadingIndicator'
import { GestureTrail } from './GestureTrail'
import type { MouseGestureApi } from '../state/useMouseGesture'
import type { SessionSlice } from '../state/sessionSlice'
import type { OptimisticBusy } from '../state/useOptimisticBusy'
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
  /** 전송 직후의 「응답 중」 (App 소유). `busy` 는 isStreaming 을 포함한다 —
   *  turn_started 가 오기 전의 공백에도 진행 표시가 서 있게 한다. */
  optimistic: OptimisticBusy
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
        onAskShell={(command, output, note) => {
          // 셸 결과 넘김도 LLM 으로 가는 전송이다 — 입력창 경로처럼 즉시 「응답 중」
          props.optimistic.markSent()
          void window.davis.sendChat({
            // 모델은 이 명령을 본 적이 없다 — 무엇을 돌렸는지부터 알려준다.
            // 사용자가 덧붙인 말은 **맨 뒤**에 둔다: 출력을 다 읽은 뒤에 오는 것이 물음이다
            query: [
              '다음 명령을 실행했습니다.',
              '',
              `$ ${command}`,
              '',
              '```',
              output,
              '```',
              ...(note ? ['', note] : []),
            ].join('\n'),
            ...props.chatContext,
          })
        }}
        onDecideReview={sendReviewDecision}
      />
      <div className="chat-gutter">
        {/* 승인 대기 중에도 진행 표시를 유지한다 — 멈춘 것처럼 보이면 안 된다.
            낙관 구간(전송 후 turn_started 전)은 slice 의 mode 가 아직 idle 이라
            'requesting' 으로 채운다 — 진짜 턴이 열리면 slice 값이 이긴다 */}
        <LoadingIndicator
          active={props.optimistic.busy || waiting}
          mode={mode !== 'idle' ? mode : waiting ? 'tool-use' : 'requesting'}
          activityKey={activityKey}
        />
      </div>
    </div>
  )
}
