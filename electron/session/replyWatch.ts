// 보냈는데 **아무 응답도 오지 않는 상태**를 감시한다.
//
// 왜 필요한가: 프레임이 소켓으로 나갔다고 해서 runtime 이 받아들였다는 뜻이 아니다.
// 인증되지 않은 세션의 chat_request 는 runtime 이 **에러도 없이 버린다.** 그러면 화면에는
// 사용자 말풍선만 남고 영원히 답이 오지 않는다 — 실측(2026-07-29)에서 사용자가 본 상태다.
//
// 이 감시는 원인을 고치지 않는다. 원인은 그때그때 다르고 앞으로도 새로 생긴다.
// 이건 **"침묵으로 끝나는 경우는 없다"는 최후 보장**이다.

/**
 * 요청을 보낸 뒤 이만큼 아무것도 안 오면 침묵으로 본다.
 *
 * runtime 은 LLM 을 부르기 **전에** turn_started 를 낸다. 그래서 모델이 느린 것과는
 * 무관하고, 이 시간은 "요청이 접수되기까지" 만 재면 된다. 하트비트 주기(30초)와 같은
 * 값으로 둔다 — 그 사이 ping 하나는 오갔을 시간이라 연결 자체는 멀쩡한 셈이다.
 */
const DEFAULT_SILENCE_MS = 30_000

export class ReplyWatch {
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly onSilent: () => void,
    private readonly silenceMs: number = DEFAULT_SILENCE_MS,
  ) {}

  /** 요청을 보낸 직후 건다. 이미 걸려 있으면 다시 센다 (연속 전송은 마지막 것 기준). */
  arm(): void {
    this.disarm()
    if (this.silenceMs <= 0) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.onSilent()
    }, this.silenceMs)
  }

  /** 응답이 오기 시작했으면 푼다. 여러 번 불려도 안전하다. */
  disarm(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** 감시 중인가. 테스트와 진단용. */
  get armed(): boolean {
    return this.timer !== null
  }
}
