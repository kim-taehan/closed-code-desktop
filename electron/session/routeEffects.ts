import type { RouteEffect } from './chunkRouter'
import type { TurnEvent } from '../../shared/ipc/channels'

// 라우터가 해석한 결과(RouteEffect)를 화면 이벤트(TurnEvent)로 옮긴다.
//
// **여기서 청크를 다시 읽지 않는다** — 해석기는 ChunkRouter 하나다 (설계 §5).
// ChatSession 에서 떼어냈다: 그 파일이 300줄 상한에 닿았고, 이 변환은 세션 상태를
// 거의 안 쓴다(턴 id 와 알림 두 개뿐)라 따로 두면 읽기도 쉽다.

export interface RouteEffectDeps {
  /** 턴이 시작됐다 — 침묵 감시를 풀고 게이트를 연다 */
  onTurnStarted(turnId: string): void
  /** 지금 턴 id. turn_end 뒤에 오는 조각도 같은 턴에 속한다 */
  turnId(): string
  emit(event: TurnEvent): void
}

export function emitRouteEffect(effect: RouteEffect, deps: RouteEffectDeps): void {
  if (effect.type === 'turn_started') {
    deps.onTurnStarted(effect.turnId)
    deps.emit({ type: 'turn_started', turnId: effect.turnId })
    return
  }
  if (effect.type === 'text') {
    deps.emit({ type: 'text', turnId: deps.turnId(), text: effect.text })
    return
  }
  if (effect.type === 'tool_call') {
    deps.emit({
      type: 'tool_call',
      turnId: deps.turnId(),
      toolName: effect.toolName,
      ...(effect.toolCallId !== undefined ? { toolCallId: effect.toolCallId } : {}),
    })
    return
  }
  deps.emit({
    type: 'error',
    message: effect.message,
    ...(effect.code !== undefined ? { code: effect.code } : {}),
  })
}
