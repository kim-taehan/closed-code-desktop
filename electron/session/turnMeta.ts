import type { TurnMeta, TurnTokens } from '../../shared/ipc/messageTypes'

// turn_start / turn_end 가 남기는 메타를 보관한다 (설계 §5.2).
// DOM 은 만들지 않는다 — 턴 헤더의 스텝 수·경과시간·종료 판정에만 쓰인다.

export class TurnMetaStore {
  private readonly metas = new Map<string, TurnMeta>()
  private activeTurnId: string | null = null

  /**
   * turn_start. 같은 turnId 로 다시 오면 **최초 startedAt 을 보존한다** —
   * 승인 대기 후 재개되는 턴이 시간을 처음부터 다시 세지 않게 하기 위함이다.
   */
  onTurnStart(turnId: string, startedAt?: number): void {
    if (!turnId) return
    this.activeTurnId = turnId

    const existing = this.metas.get(turnId)
    if (existing) return // 재개 — 최초 startedAt 유지

    const meta: TurnMeta = { turnId }
    if (startedAt !== undefined) meta.startedAt = startedAt
    this.metas.set(turnId, meta)
  }

  /** turn_end. terminal:true 일 때만 활성 턴을 놓는다. */
  onTurnEnd(turnId: string, data: { durationMs?: number; stepCount?: number; terminal?: boolean }): void {
    if (!turnId) return

    const meta = this.metas.get(turnId) ?? { turnId }
    if (data.durationMs !== undefined) meta.durationMs = data.durationMs
    if (data.stepCount !== undefined) meta.stepCount = data.stepCount
    if (data.terminal !== undefined) meta.terminal = data.terminal
    this.metas.set(turnId, meta)

    if (data.terminal === true && this.activeTurnId === turnId) this.activeTurnId = null
  }

  /**
   * stream_end 로 턴 종료를 확정한다.
   * turn_end 청크가 오지 않는 경우에도 stream_end 가 정본이다 (설계 §4.4).
   */
  markTerminal(turnId: string, terminal: boolean): void {
    if (!turnId) return
    const meta = this.metas.get(turnId) ?? { turnId }
    meta.terminal = terminal
    this.metas.set(turnId, meta)
    if (terminal && this.activeTurnId === turnId) this.activeTurnId = null
  }

  /**
   * 토큰 사용량 기록. 종단 stream_end 에서만 부른다.
   * 비종단 세그먼트에서 기록하면 턴 중간에 토큰 줄이 떠 버린다 (설계 §6.1).
   */
  setTokens(turnId: string, tokens: TurnTokens): void {
    if (!turnId) return
    const meta = this.metas.get(turnId) ?? { turnId }
    meta.tokens = tokens
    this.metas.set(turnId, meta)
  }

  /** 지금 열려 있는 턴. 새 assistant 메시지에 이 turnId 가 찍힌다. */
  get active(): string | null {
    return this.activeTurnId
  }

  get(turnId: string): TurnMeta | undefined {
    return this.metas.get(turnId)
  }

  /** renderer 로 넘길 스냅샷 */
  snapshot(): TurnMeta[] {
    return [...this.metas.values()]
  }

  reset(): void {
    this.metas.clear()
    this.activeTurnId = null
  }
}
