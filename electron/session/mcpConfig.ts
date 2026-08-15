import { createEnvelope, parseInbound, serializeEnvelope } from '../../shared/protocol/envelope'
import { Action, Kind } from '../../shared/protocol/kinds'
import { EMPTY_MCP_STATE, parseMcpState, type McpState } from '../../shared/protocol/mcpConfig'
import { HandlerSet, type Transport, type Unsubscribe } from '../ws/transport'

// 커넥터(MCP) — kind=mcp_config.
//
// **davis 때 이 봉투가 나른 것은 개인 자격이었다.** 값은 올려보내기만 했고 응답에는 값이
// 오지 않고 키 이름만 왔다 — 원본 보관처가 이쪽이고 노출 면적을 줄이려는 것이었다.
// 그래서 여기서도 보낸 값을 따로 보관하지 않는다.
//
// **opencode 로 오며 실리는 것이 자격에서 연결 상태로 바뀌었다.** 이 파일은 그대로 두었다 —
// 봉투·action·"응답이 정본" 이라는 성질이 셋 다 그대로라 번역만으로 닿았다
// (`electron/opencode/mcpConfig.ts` 가 그 번역이고 실측 근거의 정본이다).
// 아래 메서드 주석에서 자격을 말하는 대목은 그 사실에 맞춰 고쳐 두었다.

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
   * 서버를 켜거나 끈다 (davis: 개인 자격을 저장하거나 해제한다).
   *
   * davis 규칙은 "`enabled: false` 이거나 자격이 비면 **해제**" 였다. opencode 어댑터는
   * `enabled` 만 읽어 connect/disconnect 로 번역하고 `credentials` 는 버린다 — 넣을 자리가 없다.
   *
   * **저장 뒤에는 응답으로 상태가 갱신되므로 여기서 낙관적으로 고치지 않는다.**
   * 이 규칙은 opencode 에서 더 중요해졌다: connect 는 붙는 데 실패해도 `true` 를 주므로
   * 응답을 다시 읽는 것 말고는 성공을 알 방법이 없다 (`opencode/mcpApi.ts` 실측).
   */
  set(serverName: string, credentials: Record<string, string>, enabled = true): boolean {
    return this.send(Action.MCP_CONFIG_SET, { server_name: serverName, enabled, credentials })
  }

  /**
   * 저장하지 않고 이 자격으로 붙어만 본다 (davis).
   *
   * ⚠️ **opencode 에는 대응 표면이 없다** — 붙는 것이 곧 설정을 켜는 것이라 "붙어만 보기" 가
   * 성립하지 않는다. 어댑터는 이 action 에 답하지 않고, 커넥터 화면도 부르지 않는다.
   * 남겨 둔 것은 davis 계약의 셋째 action 이 무엇이었는지가 위 두 개를 읽는 근거라서다.
   */
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
