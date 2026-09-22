import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fakeServer, makeTransport, tick } from './transportTestKit'

/**
 * **확장 세션의 이벤트는 사용자 채팅에 0건** (확장 재설계 §2-3, 결정 F4 — 사용자 채팅 쪽).
 *
 * 확장 세션은 사용자 채팅과 **같은 서버·같은 디렉토리**에 선다. `/event` 는 그 인스턴스의 세션 전부를
 * 싣으므로 그 이벤트가 이 창의 스트림에도 그대로 흘러든다 (실서버 확인은 `extensionRunLive.test.ts`). 막는 것은 `sessionFilter.ts` 의 `admits` 이고 **그 판정은 이번에 고치지
 * 않았다** — 이 시험은 실측 원문 한 턴(`tests/fixtures/opencode/extension-turn.json`)을 사용자 턴이
 * 도는 창에 흘려 그것을 잠근다. 반대 방향(사용자 이벤트 → `ai.run` 0건)은 `extensionRun.test.ts`.
 */

const fixture = JSON.parse(
  readFileSync(join(__dirname, '../../tests/fixtures/opencode/extension-turn.json'), 'utf8'),
) as { events: { type: string; properties: Record<string, unknown> }[] }

/** 사용자 턴이 `ses_fake` 에서 도는 창 */
async function userTurnRunning() {
  const server = fakeServer()
  const transport = makeTransport(server)
  const seen: Record<string, unknown>[] = []
  transport.onMessage((raw) => seen.push(JSON.parse(raw) as Record<string, unknown>))
  transport.open()
  await tick()
  server.emit('server.connected')
  await tick()
  const send = (frame: Record<string, unknown>) => transport.send(JSON.stringify({ reqId: 'r', ...frame }))
  send({ kind: 'workspace', action: 'workspace_sync', data: { workspace: { workspacePath: '/tmp/proj' } } })
  await tick()
  send({ kind: 'chat', action: 'chat_request', data: { query: '사용자 질문' } })
  await tick()
  expect(seen.some((frame) => frame['action'] === 'stream_start')).toBe(true)
  return { server, transport, seen }
}

function replay(server: ReturnType<typeof fakeServer>, sessionId: string): void {
  for (const event of fixture.events) {
    server.emit(event.type, JSON.parse(JSON.stringify(event.properties).replaceAll('ses_ext_live', sessionId)))
  }
}

describe('확장 세션 이벤트는 사용자 채팅으로 가지 않는다', () => {
  it('실측 한 턴을 다른 세션 id 로 흘리면 프레임이 하나도 안 나간다 — 글·도구·idle 전부', async () => {
    const { server, transport, seen } = await userTurnRunning()
    const before = seen.length

    replay(server, 'ses_ext1')
    await tick()

    expect(seen.slice(before), '확장 세션의 글·도구 카드·턴 종료가 사용자 채팅에 섰다').toEqual([])
    transport.close()
  })

  // 대조군 — 같은 원문을 **사용자 세션 id 로** 흘리면 프레임이 나온다. 이것이 없으면 위 시험은
  // 원문이 번역까지 닿지도 않아서 0 인 것(헛초록)과 구분되지 않는다.
  it('대조군: 같은 원문을 사용자 세션 id 로 흘리면 글과 턴 종료가 나온다', async () => {
    const { server, transport, seen } = await userTurnRunning()
    const before = seen.length

    replay(server, 'ses_fake')
    await tick()

    const after = seen.slice(before)
    expect(after.some((frame) => frame['action'] === 'stream_end')).toBe(true)
    expect(after.length).toBeGreaterThan(5)
    transport.close()
  })
})
