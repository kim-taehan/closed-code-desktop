// 컴포저 오른쪽 끝의 한 자리 — 평소엔 전송(↑), 응답 중엔 중지(빨간 원 안의 흰 네모).
//
// 같은 자리를 두 버튼이 나눠 쓰는 이유: 버튼이 움직이면 누르려던 손이 빗나간다.
// **Enter 전송(대기열 쌓기)은 stop 이 떠 있어도 그대로 산다** — 바뀌는 것은 버튼뿐이다.
// 연타 방어(pending)와 상한 해제는 useCancelRequest(TurnControls.tsx)가 쥔다.

export interface ComposerSendButtonProps {
  /** 있으면 중지 버튼이 뜬다. 없으면 전송 버튼이다. */
  stop?: { pending: boolean; onPress: () => void } | undefined
  /** 전송 금지 (연결 대기 등) */
  disabled: boolean
  /** 보낼 내용이 있는가 (공백뿐이면 전송 버튼을 잠근다) */
  canSend: boolean
  onSend: () => void
}

export function ComposerSendButton({ stop, disabled, canSend, onSend }: ComposerSendButtonProps) {
  if (stop) {
    return (
      <button
        type="button"
        className="composer__send composer__send--stop"
        onClick={stop.onPress}
        disabled={stop.pending}
        title="응답 중단 (Esc)"
        aria-label="응답 중단"
      >
        <span className="composer__stop-square" aria-hidden="true" />
      </button>
    )
  }
  return (
    <button
      type="button"
      className="composer__send"
      onClick={onSend}
      disabled={disabled || !canSend}
      title="전송 (Enter)"
      aria-label="전송"
    >
      ↑
    </button>
  )
}
