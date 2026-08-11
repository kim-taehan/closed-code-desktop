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
})
