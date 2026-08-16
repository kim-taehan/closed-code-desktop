import { useEffect, useState } from 'react'

// 전송 직후의 「응답 중」 을 화면이 먼저 아는 상태.
//
// `isStreaming` 은 런타임이 `turn_started` 를 SSE 로 돌려줘야 켜진다. 그것만 보면
// **중지 버튼이 왕복 시간만큼 늦게 바뀐다** — 사내망에서는 그 지연이 눈에 띈다
// (사용자 지적, 2026-08-15: "llm model 에게 요청갔을 때 변경되는 느낌"). 보냈다는
// 사실은 우리가 먼저 아니까, 보내는 자리에서 켜고 진짜 스트리밍이 시작되면 넘긴다.

/**
 * 낙관 상태를 스스로 푸는 상한.
 *
 * 정상 경로에서는 `turn_started` 가 이 시간 안에 와서 쓰이지 않는다. 쓰이는 것은
 * 그 이벤트가 **영영 안 오는 경우**뿐이라 — 느린 왕복을 넉넉히 넘기되
 * "굳었다" 고 느끼기 전에는 풀려야 한다.
 *
 * 내보내는 이유는 시험 때문이다 (`useAutoHeal` 의 `RECHECK_MS` 와 같은 규칙) — 시험이
 * 10000 을 손으로 적으면 값을 고친 날 그 시험만 조용히 헛돈다.
 */
export const HANDOFF_MS = 10_000

export interface OptimisticBusy {
  /** 낙관 + 실제를 합친 값. 중지 버튼·전송 큐가 함께 본다. */
  busy: boolean
  /** LLM 으로 보내는 자리에서 부른다. 셸·데스크톱 명령에는 부르지 않는다. */
  markSent: () => void
}

export function useOptimisticBusy(isStreaming: boolean): OptimisticBusy {
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!sending) return
    // 인계 — 런타임이 턴을 열었으니 낙관 상태는 물러난다.
    if (isStreaming) {
      setSending(false)
      return
    }
    // 턴이 영영 안 열리는 경우의 유일한 탈출구다 (전송 자체가 실패했을 때).
    // 이게 없으면 중지 버튼이 굳어 다음 질문을 보낼 수 없다.
    const timer = setTimeout(() => setSending(false), HANDOFF_MS)
    return () => clearTimeout(timer)
  }, [sending, isStreaming])

  return { busy: isStreaming || sending, markSent: () => setSending(true) }
}
