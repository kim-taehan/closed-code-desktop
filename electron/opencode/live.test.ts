import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Handshake } from '../session/handshake'
import { ChunkRouter } from '../session/chunkRouter'
import { MessageStore } from '../session/messageStore'
import { TurnMetaStore } from '../session/turnMeta'
import { parseInbound } from '../../shared/protocol/envelope'
import { parseMcpState } from '../../shared/protocol/mcpConfig'
import { OpencodeConnection } from './connection'

// 실제 opencode 서버에 붙여 한 턴을 끝까지 돌리는 검증.
//
// **기본으로는 건너뛴다** — 서버·모델이 필요해 CI 에서 돌 수 없다. 켜는 법:
//
//   opencode serve --port 4096 --hostname 127.0.0.1
//   OPENCODE_LIVE=1 npx vitest run electron/opencode/live.test.ts
//
// 이 테스트가 잡는 것: 가짜 서버로는 절대 안 잡히는 **계약 어긋남**.
// 실제로 여기서 두 건을 잡았다 —
//   (1) `/api/*` 응답이 `{data:...}` 로 감싸여 와 세션 id 가 undefined 로 샜다
//   (2) `/api/prompt` 는 `session.next.*` 를 흘리는데 번역기가 레거시 `message.part.*`
//       기준이라 청크가 한 개도 안 잡혔다
// 둘 다 타입체크·단위테스트는 초록이었다.

const LIVE = process.env['OPENCODE_LIVE'] === '1'
const BASE = process.env['OPENCODE_URL'] ?? 'http://127.0.0.1:4096'

describe.skipIf(!LIVE)('live opencode', () => {
  it('핸드셰이크 → 도구 사용 턴 → 종료가 화면 모델까지 도달한다', async () => {
    const transport = new OpencodeConnection({ baseUrl: BASE, autoReconnect: false })
    const messages = new MessageStore()
    const turns = new TurnMetaStore()
    const unknown: string[] = []
    const router = new ChunkRouter({ messages, turns, onUnknownType: (type) => unknown.push(type) })

    let ended = false
    transport.onMessage((raw) => {
      const frame = parseInbound(raw)
      if (!frame) return
      if (frame.action === 'stream_chunk') {
        router.route(frame.data as Record<string, unknown>, frame.streamId ?? undefined)
      }
      if (frame.action === 'stream_end') ended = true
    })

    // **이 레포 루트를 워크스페이스로 주지 말 것.** node_modules 가 700MB 가까워
    // opencode 가 초기 스캔에서 멈추고, 증상이 "어댑터가 이벤트를 못 받는다" 로 보인다
    // (실제로 이걸로 한참 헤맸다). 어댑터 계약 검증에는 작은 디렉터리면 충분하다.
    const workspacePath = mkdtempSync(join(tmpdir(), 'oc-live-'))
    writeFileSync(join(workspacePath, 'sample.txt'), 'hello from open-code-desktop\n')

    const handshake = new Handshake(transport, {
      workspacePath,
      projectName: 'oc-live',
    })
    const ready = handshake.run()
    await transport.connect()
    await ready
    expect(handshake.state.stage).toBe('ready')

    transport.send(
      JSON.stringify({
        kind: 'chat',
        action: 'chat_request',
        reqId: 'r1',
        data: { query: 'Read sample.txt and tell me its contents in one short sentence.' },
      }),
    )

    const deadline = Date.now() + 120_000
    while (!ended && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250))
    transport.close()

    const items = messages.snapshot()
    expect(ended).toBe(true)
    // 매핑표에 없는 청크가 하나라도 있으면 렌더 규칙이 비어 있다는 뜻이다.
    expect(unknown).toEqual([])
    expect(items.some((item) => item.kind === 'text')).toBe(true)
  }, 150_000)

  /**
   * 중단이 **실제로 화면까지 끝나는가.**
   *
   * 가짜 서버로는 못 잡는 자리다 — 중단의 종료 신호가 `step.ended` 가 아니라
   * `step.failed` 라는 사실 자체가 실측에서만 나왔다 (1.18.18, 2026-08-14).
   * 그걸 안 옮기던 동안 턴을 닫는 것은 main 의 5초 강제 종단뿐이었고,
   * 사용자에게는 그 5초가 "중단 버튼이 무시됐다" 로 보였다.
   * 그래서 여기서 재는 것은 "닫히는가" 가 아니라 **얼마나 빨리 닫히는가** 다.
   */
  it('중단하면 그 자리에서 stream_end 가 온다 — 5초 강제 종단을 기다리지 않는다', async () => {
    const transport = new OpencodeConnection({ baseUrl: BASE, autoReconnect: false })
    let firstChunk = false
    let endedAt = 0
    let endData: Record<string, unknown> | null = null
    transport.onMessage((raw) => {
      const frame = parseInbound(raw)
      if (!frame) return
      if (frame.action === 'stream_chunk') firstChunk = true
      if (frame.action === 'stream_end' && endedAt === 0) {
        endedAt = Date.now()
        endData = (frame.data ?? {}) as Record<string, unknown>
      }
    })

    const workspacePath = mkdtempSync(join(tmpdir(), 'oc-live-cancel-'))
    const handshake = new Handshake(transport, { workspacePath, projectName: 'oc-live-cancel' })
    const ready = handshake.run()
    await transport.connect()
    await ready

    transport.send(
      JSON.stringify({
        kind: 'chat',
        action: 'chat_request',
        reqId: 'r1',
        data: { query: 'Count from 1 to 300, one number per line. No explanation.' },
      }),
    )

    const startDeadline = Date.now() + 60_000
    while (!firstChunk && Date.now() < startDeadline) await new Promise((r) => setTimeout(r, 100))
    expect(firstChunk).toBe(true)

    const cancelledAt = Date.now()
    transport.send(JSON.stringify({ kind: 'chat', action: 'stream_cancel', reqId: 'r2', data: {} }))

    const deadline = Date.now() + 20_000
    while (endedAt === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50))
    transport.close()

    expect(endedAt).toBeGreaterThan(0)
    // main 의 CANCEL_FORCE_CLOSE_MS(5초)보다 확실히 빨라야 한다 — 그 값에 걸려 닫히는
    // 것이라면 어댑터는 여전히 중단 신호를 못 옮기고 있는 것이다.
    expect(endedAt - cancelledAt).toBeLessThan(3_000)
    // 사용자가 끊은 것은 실패가 아니다
    expect(endData?.['failed']).toBeUndefined()
  }, 120_000)

  /**
   * 커넥터 다이얼로그가 **실물 상태로** 차는가 (`mcpConfig.ts`).
   *
   * 여기서만 잡히는 것 셋이고, 셋 다 단위테스트가 초록인 채로 틀릴 수 있는 자리다:
   *   (1) 어댑터가 `workspace_sync` 에서 붙잡은 디렉토리를 MCP 질의에 제대로 싣는가
   *       — 안 실으면 서버 cwd 의 목록이 와서 **남의 프로젝트 서버가 화면에 뜬다**
   *   (2) 상태(`GET /mcp`)와 설정(`GET /config`)을 합친 것이 실제로 한 항목이 되는가
   *   (3) 실패 서버의 `error` 가 오는가 — 이 필드가 `MCPStatusFailed` 에만 있다
   *
   * ⚠️ **`GET /mcp` 는 죽은 원격 서버 하나마다 수십 초를 쓴다** (붙어 보고 답한다).
   * 그래서 타임아웃이 다른 것들보다 넉넉하다.
   */
  it('mcp_config 봉투가 실물 서버 상태로 채워져 돌아온다', async () => {
    const transport = new OpencodeConnection({ baseUrl: BASE, autoReconnect: false })
    let state: Record<string, unknown> | null = null
    transport.onMessage((raw) => {
      const frame = parseInbound(raw)
      if (frame?.kind === 'mcp_config') state = (frame.data ?? {}) as Record<string, unknown>
    })

    // 임시 디렉터리에 MCP 를 심는다 — `?directory=` 만 맞으면 git 이 아니어도 읽는다 (실측).
    // 죽은 주소를 일부러 쓴다: `failed` 와 그 `error` 원문이 이 검증의 본체다.
    const workspacePath = mkdtempSync(join(tmpdir(), 'oc-live-mcp-'))
    writeFileSync(
      join(workspacePath, 'opencode.json'),
      JSON.stringify({
        mcp: {
          livedead: { type: 'remote', url: 'http://127.0.0.1:9/mcp', enabled: true },
          liveoff: { type: 'remote', url: 'http://127.0.0.1:9998/mcp', enabled: false },
          // 스키마를 어긴 항목 (remote 인데 url 이 없다). opencode 가 버려서 `GET /mcp` 에는
          // 안 나타나고 `/config` 에만 껍데기로 남는다 — 합집합을 안 돌면 화면에서 사라진다.
          livehusk: { type: 'remote', enabled: true },
        },
      }),
    )

    const handshake = new Handshake(transport, { workspacePath, projectName: 'oc-live-mcp' })
    const ready = handshake.run()
    await transport.connect()
    await ready

    transport.send(JSON.stringify({ kind: 'mcp_config', action: 'mcp_config_status', reqId: 'm1', data: {} }))
    const deadline = Date.now() + 180_000
    while (state === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250))

    const servers = parseMcpState(state).servers
    const dead = servers.find((server) => server.serverName === 'livedead')
    const off = servers.find((server) => server.serverName === 'liveoff')
    // 이 프로젝트에 심은 둘이 보여야 한다 — 안 보이면 디렉토리가 안 실린 것이다
    expect(dead).toBeDefined()
    expect(off).toBeDefined()
    expect(dead?.status).toBe('failed')
    // 상태는 `GET /mcp`, 주소·갈래는 `GET /config` — 합쳐져야 한 항목이 된다
    expect(dead?.transport).toBe('remote')
    expect(dead?.url).toBe('http://127.0.0.1:9/mcp')
    expect(dead?.error ?? '').not.toBe('')
    expect(off?.status).toBe('disabled')
    // opencode 가 버린 항목도 살아남아야 한다 — 안 그러면 사용자 오타가 조용히 사라진다
    const husk = servers.find((server) => server.serverName === 'livehusk')
    expect(husk?.status).toBe('unknown')

    // 「다시 연결」이 성공을 지어내지 않는가. opencode 의 connect 는 **붙는 데 실패해도
    // `true`** 를 준다 — 그 불린을 믿으면 죽은 서버가 「연결됨」으로 뜬다. 어댑터는 값을
    // 버리고 상태를 다시 읽으므로, 여전히 죽은 주소는 여기서도 `failed` 여야 한다.
    state = null
    transport.send(
      JSON.stringify({
        kind: 'mcp_config',
        action: 'mcp_config_set',
        reqId: 'm2',
        data: { server_name: 'livedead', enabled: true },
      }),
    )
    const retryDeadline = Date.now() + 180_000
    while (state === null && Date.now() < retryDeadline) await new Promise((r) => setTimeout(r, 250))
    transport.close()

    const retried = parseMcpState(state).servers.find((server) => server.serverName === 'livedead')
    expect(retried?.status).toBe('failed')
  }, 200_000)
})
