import { createEnvelope, parseInbound, serializeEnvelope } from '../../shared/protocol/envelope'
import { Action, Kind } from '../../shared/protocol/kinds'
import { EMPTY_MCP_STATE, parseMcpState, type McpState } from '../../shared/protocol/mcpConfig'
import { HandlerSet, type Transport, type Unsubscribe } from '../ws/transport'

// 개인 MCP 자격 설정 (kind=mcp_config).
//
// **자격 값은 올려보내기만 한다.** 응답에는 값이 오지 않고 키 이름만 온다 —
// 원본 보관처는 이쪽이고 노출 면적을 줄이려는 것이다 (runtime 주석 참조).
// 그래서 여기서도 보낸 값을 따로 보관하지 않는다.

export class McpConfigController {
  private state: McpState = EMPTY_MCP_STATE
  private unsubscribe: Unsubscribe | null = null
  private readonly handlers = new HandlerSet<[McpState]>()

  constructor(private readonly transport: Transport) {}

  get current(): McpState {
    return this.state
  }

  start(): void {
    this.unsubscribe = this.transport.onMessage((raw) => this.handle(raw))
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.handlers.clear()
  }

  onChange(handler: (state: McpState) => void): Unsubscribe {
    return this.handlers.add(handler)
  }

  /** 서버 목록과 정책을 받아온다. server_name 을 비우면 전체다. */
  requestStatus(): boolean {
    return this.send(Action.MCP_CONFIG_STATUS, {})
  }

  /**
   * 개인 자격을 저장하거나 해제한다.
   *
   * `enabled: false` 이거나 자격이 비면 **해제**다 (runtime 규칙).
   * 저장 뒤에는 응답으로 상태가 갱신되므로 여기서 낙관적으로 고치지 않는다.
   */
  set(serverName: string, credentials: Record<string, string>, enabled = true): boolean {
    return this.send(Action.MCP_CONFIG_SET, { server_name: serverName, enabled, credentials })
  }

  /** 저장하지 않고 이 자격으로 붙어만 본다 */
  test(serverName: string, credentials: Record<string, string>): boolean {
    return this.send(Action.MCP_CONFIG_TEST, { server_name: serverName, credentials })
  }

  private send(action: Action, data: Record<string, unknown>): boolean {
    // 이 도메인은 snake_case 가 정본이다 — camelCase 별칭이 없다
    const envelope = createEnvelope(Kind.MCP_CONFIG, action, data)
    return this.transport.send(serializeEnvelope(envelope))
  }

  private handle(raw: string): void {
    const frame = parseInbound(raw)
    if (frame === null || frame.kind !== Kind.MCP_CONFIG) return

    this.state = parseMcpState(frame.data)
    this.handlers.emit(this.state)
  }
}
