import { useEffect, useReducer } from 'react'
import type { ChatSendPayload } from '../../shared/ipc/channels'

// 응답 중에 보낸 메시지를 쌓아 두고, 턴이 끝나면 **한 번에** 보낸다.
//
// 겹쳐 보내면 런타임이 한 요청을 처리하는 중에 또 받아 턴을 둘로 굴린다 (이중 처리).
// 막고 버리는 대신 큐에 쌓고, 여러 건이면 줄바꿈으로 이어 하나로 합쳐 보낸다.
//
// **프로젝트별로 따로 둔다.** ChatComposer 는 프로젝트가 바뀌어도 remount 되지 않으므로
// (useInputHistory 와 같은 판단) 큐를 컴포넌트 밖 모듈 스토어에 projectId 로 나눠 둔다.
// 안 그러면 A 에서 쌓은 대기열이 B 로 옮겨도 그대로 보인다.
//
// **전송을 상태 업데이터 안에서 하지 않는다.** StrictMode 는 업데이터를 두 번 호출해
// 순수성을 검사하는데, 그 안에서 sendChat 을 부르면 질문이 두 번 들어간다.
// 그래서 큐의 정본은 모듈 Map 에 두고, 화면 갱신은 강제 리렌더로만 한다.

/** projectId → 대기 중인 메시지들 */
const QUEUES = new Map<string, ChatSendPayload[]>()
/** projectId → 직전 스트리밍 여부 (프로젝트를 옮겨도 그 프로젝트의 턴 종료를 놓치지 않게) */
const WAS_STREAMING = new Map<string, boolean>()

export interface SendQueue {
  pending: number
  /** 쌓인 메시지 본문들 (미리보기용) */
  queries: string[]
  submit: (payload: ChatSendPayload) => void
  /** 쌓인 것을 하나로 합쳐 돌려주고 큐를 비운다. 없으면 null. (입력창으로 되돌릴 때) */
  take: () => ChatSendPayload | null
}

export function useSendQueue(projectId: string | null, isStreaming: boolean): SendQueue {
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const key = projectId ?? ''
  const queue = QUEUES.get(key) ?? []

  const set = (next: ChatSendPayload[]) => {
    if (next.length > 0) QUEUES.set(key, next)
    else QUEUES.delete(key)
    bump()
  }

  // 이 프로젝트의 턴이 **끝나는 순간에만** 쌓인 것을 한 번에 보낸다.
  // 전송은 이 바깥 — 업데이터 안이 아니다. projectId 로 나눠 추적하므로 탭을 옮겨도 정확하다.
  useEffect(() => {
    const was = WAS_STREAMING.get(key) ?? false
    WAS_STREAMING.set(key, isStreaming)
    const justEnded = was && !isStreaming
    const pending = QUEUES.get(key) ?? []
    if (!justEnded || pending.length === 0) return
    QUEUES.delete(key)
    bump()
    void window.davis.sendChat(merge(pending))
  }, [key, isStreaming])

  return {
    pending: queue.length,
    queries: queue.map((item) => item.query),
    submit: (payload) => {
      // 앞에 대기가 있거나 응답 중이면 뒤에 붙인다. 아니면 바로 보낸다.
      const current = QUEUES.get(key) ?? []
      if (isStreaming || current.length > 0) set([...current, payload])
      else void window.davis.sendChat(payload)
    },
    take: () => {
      const pending = QUEUES.get(key) ?? []
      const merged = pending.length > 0 ? merge(pending) : null
      if (merged) set([])
      return merged
    },
  }
}

/**
 * 쌓인 메시지를 하나로 합친다. 본문은 줄바꿈으로 잇고 첨부는 모은다.
 *
 * **필드를 하나씩 골라 다시 쌓지 않는다.** 그렇게 하면 페이로드에 필드가 늘 때마다
 * 여기 적어 주지 않은 것이 조용히 사라진다 — `model`(DC-1322 요청별 모델 오버라이드)이
 * 실제로 그렇게 새고 있었다. 단건이면 `items[0]` 을 그대로 돌려주므로 **응답 중에 두 건
 * 이상 쌓였을 때만** 재현돼 간헐적으로 보였다.
 *
 * 그래서 마지막 것을 바탕에 깔고 **이어 붙일 수 있는 것만** 덮어쓴다. 이어 붙일 수 없는
 * 것(모델·편집기 상태)은 가장 마지막 입력 시점의 값이 사실이다 — 사용자가 마지막으로
 * 보고 고른 것이 그것이다.
 */
function merge(items: ChatSendPayload[]): ChatSendPayload {
  const last = items[items.length - 1]!
  if (items.length === 1) return last
  return {
    ...last,
    query: items.map((item) => item.query).join('\n'),
    images: items.flatMap((item) => item.images ?? []),
    files: items.flatMap((item) => item.files ?? []),
    attachments: items.flatMap((item) => item.attachments ?? []),
  }
}
