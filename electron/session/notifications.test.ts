import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectAndHandshake, type SessionFixture } from '../../tests/fake-runtime/chatSessionKit'
import { NotificationController } from './notifications'
import type { UserNotification } from '../../shared/protocol/notification'

// kind=notification push 수신 (ADR-053).
//
// 페이로드는 runtime 골든 픽스처를 그대로 옮겼다 —
// davis-code-runtime/tests/protocol_fixtures/fixtures/notification.notify.*.s2c.json
// 필드가 어긋나면 여기서 깨져야 한다. IDE 3종과 같은 계약이다.

let fixture: SessionFixture | null = null
let controller: NotificationController | null = null

afterEach(async () => {
  controller?.stop()
  controller = null
  await fixture?.dispose()
  fixture = null
})

async function startController(): Promise<{ seen: UserNotification[] }> {
  fixture = await connectAndHandshake({})
  controller = new NotificationController(fixture.connection)
  const seen: UserNotification[] = []
  controller.onNotification((n) => seen.push(n))
  controller.start()
  return { seen }
}

// 픽스처의 `replyTo: null` / `streamId: null` 은 옮기지 않는다 — 가짜 런타임의
// ServerFrame 이 두 필드를 optional 로 두어 null 을 받지 않고, 파싱도 kind·action·data
// 셋만 본다. 계약에서 중요한 것은 **data 의 모양**이라 그쪽만 픽스처 그대로 옮긴다.
/** 골든 픽스처 notification.notify.agent.s2c.json */
const AGENT_FRAME = {
  kind: 'notification',
  action: 'notify',
  chatId: 'chat-fixture-0001',
  timestamp: '2026-01-01T00:00:00Z',
  data: {
    attachments: ['/home/fixture/workspace/reports/coverage.html'],
    message: 'All 128 tests passed. Coverage 91%.',
    refId: null,
    source: 'agent',
    status: 'normal',
    title: 'Tests finished',
  },
}

/** 골든 픽스처 notification.notify.loop_end.s2c.json — title 이 null 이다 */
const LOOP_END_FRAME = {
  ...AGENT_FRAME,
  data: {
    attachments: [],
    message: 'Loop stopped: reached max iterations (20)',
    refId: 'loop-fixture-0001',
    source: 'loop',
    status: 'proactive',
    title: null,
  },
}

describe('notification — 사용자 알림 push', () => {
  it('골든 픽스처(agent)를 그대로 판다', async () => {
    const { seen } = await startController()
    fixture!.server.push([AGENT_FRAME])

    await vi.waitFor(() => expect(seen).toHaveLength(1))
    expect(seen[0]).toEqual({
      title: 'Tests finished',
      message: 'All 128 tests passed. Coverage 91%.',
      source: 'agent',
      status: 'normal',
      refId: null,
      attachments: ['/home/fixture/workspace/reports/coverage.html'],
    })
  })

  it('title 이 null 이어도 버리지 않는다 (loop_end·proactive)', async () => {
    const { seen } = await startController()
    fixture!.server.push([LOOP_END_FRAME])

    await vi.waitFor(() => expect(seen).toHaveLength(1))
    expect(seen[0]?.title).toBeNull()
    expect(seen[0]?.status).toBe('proactive')
    expect(seen[0]?.refId).toBe('loop-fixture-0001')
  })

  it('message 가 없으면 띄울 것이 없어 버린다', async () => {
    const { seen } = await startController()
    fixture!.server.push([{ ...AGENT_FRAME, data: { ...AGENT_FRAME.data, message: '' } }])
    // 뒤이어 정상 프레임을 보내, 걸러진 것이 "아직 안 온 것"과 구분되게 한다
    fixture!.server.push([AGENT_FRAME])

    await vi.waitFor(() => expect(seen).toHaveLength(1))
    expect(seen[0]?.message).toBe('All 128 tests passed. Coverage 91%.')
  })

  it('다른 kind 는 건드리지 않는다', async () => {
    const { seen } = await startController()
    fixture!.server.push([{ ...AGENT_FRAME, kind: 'system', action: 'announcement' }])
    fixture!.server.push([AGENT_FRAME])

    await vi.waitFor(() => expect(seen).toHaveLength(1))
  })

  it('stop 이후에는 받지 않는다', async () => {
    const { seen } = await startController()
    controller!.stop()
    fixture!.server.push([AGENT_FRAME])

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(seen).toHaveLength(0)
  })
})
