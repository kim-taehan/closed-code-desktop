import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Handshake } from '../session/handshake'
import { ChunkRouter } from '../session/chunkRouter'
import { MessageStore } from '../session/messageStore'
import { TurnMetaStore } from '../session/turnMeta'
import { parseInbound } from '../../shared/protocol/envelope'
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
})
