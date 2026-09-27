import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeOpencodeServer } from '../../tests/fake-opencode/FakeOpencodeServer'
import { FakePhone } from '../../tests/remote/MemoryLink'
import { OpencodeServerPool } from '../opencode/serverPool'
import type { SpawnedServer } from '../opencode/serverProcess'
import { Channel, type ChatSnapshotPayload, type ProjectScoped } from '../../shared/ipc/channels'
import { DEFAULT_SETTINGS } from '../../shared/settings/appSettings'
import type { ProjectRecord } from '../../shared/projects/projectRecord'
import { RemoteService } from './service'

// **실제 경로**를 통째로 흘린다 — `FakeOpencodeServer → ProjectSession → SessionBridge →
// FrameSink → RemoteService → 조각 → 휴대폰`. 계획 §9 P1 의 ①·②·④, 그리고 ⑥(추출 회귀)이 여기다.
//
// 왜 여기여야 하나: 매핑(`projection.test.ts`)과 관문(`service.test.ts`)이 각각 잠겨 있어도
// **그 사이 배선이 잠겼는지는 다른 질문이다** (하네스 `contract-crosscheck` 원칙 8 — 두 층이
// 다 잠겼다는 것을 근거로 위험을 낮게 봤다가 틀린 전례가 있다).
//
// 격리(②)는 `electron/session/multiSession.test.ts` 를 본떴다 — 두 프로젝트를 **같은 서버**에
// 붙인다. `/event` 는 인스턴스 전역이라 B 의 이벤트가 A 의 스트림으로도 들어오고, 그것을
// 어댑터의 `admits` 가 먼저 거른다. 원격은 그 위에 **구독** 한 겹을 더한다 — 이 시험이 겨누는 것은
// 그 두 번째 겹이다.

const handlers = new Map<string, (event: unknown, payload: unknown) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, payload: unknown) => unknown) =>
      handlers.set(channel, handler),
    removeHandler: (channel: string) => handlers.delete(channel),
  },
}))

function projectOf(id: string): ProjectRecord {
  return { id, root: `/tmp/${id}`, name: id, favorite: false, lastOpenedAt: 0 }
}

/** 화면으로 나간 것 — 팬아웃이 그대로 도는지 보는 자리 */
interface Sent {
  channel: string
  scoped: ProjectScoped<unknown>
}

let server: FakeOpencodeServer
let sent: Sent[] = []

beforeEach(async () => {
  handlers.clear()
  sent = []
  server = new FakeOpencodeServer()
  await server.start()
})

afterEach(async () => {
  await server.stop()
})

function windowOf() {
  return {
    isDestroyed: () => false,
    webContents: {
      send: (channel: string, scoped: ProjectScoped<unknown>) => sent.push({ channel, scoped }),
    },
  } as never
}

async function setup(options: { remoteEnabled?: boolean; mirror?: 'throw' } = {}) {
  const { SessionBridge } = await import('../ipc/bridge')
  const projects = [projectOf('a'), projectOf('b')]
  const pool = new OpencodeServerPool({
    start: () =>
      Promise.resolve({
        url: server.baseUrl,
        pid: 1,
        bin: '/bin/opencode',
        stop: () => Promise.resolve(),
        onExit: () => {},
      } satisfies SpawnedServer),
  })
  const remote = new RemoteService({
    settings: () => Promise.resolve({ ...DEFAULT_SETTINGS, remoteEnabled: options.remoteEnabled ?? true }),
    projects: () => projects,
  })
  const phone = new FakePhone()
  const bridge = new SessionBridge(windowOf(), pool, {
    onFrame:
      options.mirror === 'throw'
        ? () => {
            throw new Error('원격이 터졌다')
          }
        : remote.mirror,
  })
  bridge.register()
  return { bridge, remote, phone, projects, pool }
}

/** 붙고 hello·subscribe 까지 */
async function watching(remote: RemoteService, phone: FakePhone, projectIds: string[]) {
  expect(await remote.attach(phone.link)).toBe(true)
  phone.send({ t: 'hello', p: { protocol: 0, deviceName: '내 폰' } })
  phone.send({ t: 'subscribe', p: { projectIds } })
  phone.take()
}

/** 휴대폰이 받은 프레임으로 대화를 다시 만든다 — 실제 앱이 할 일과 같은 계산 */
function rebuild(phone: FakePhone, projectId: string, into = new Map<string, string>()) {
  for (const frame of phone.take()) {
    if (frame.t === 'delta' && frame.projectId === projectId) {
      into.set(frame.p.messageId, (into.get(frame.p.messageId) ?? '') + frame.p.append)
    } else if (frame.t === 'snapshot' && frame.projectId === projectId) {
      into.clear()
      for (const message of frame.p.messages) into.set(message.id, message.content)
    }
  }
  return into
}

function lastSnapshotText(projectId: string): string {
  const snapshots = sent.filter(
    (entry) => entry.channel === Channel.CHAT_SNAPSHOT && entry.scoped.projectId === projectId,
  )
  const last = snapshots.at(-1)?.scoped.payload as ChatSnapshotPayload | undefined
  return (last?.messages ?? []).map((message) => message.content).join('')
}

async function send(bridge: { activate: (p: ProjectRecord) => Promise<void> }, project: ProjectRecord, query: string) {
  // 렌더러와 **같은 문**으로 보낸다 (`sessionHandlers.ts`). 그 문이 활성 탭으로 가는 것이
  // 계획 §4 가 짚은 오배송 위험이고, 원격 명령은 P2 에서 이 길을 타지 않는다 (`inbound.ts` 머리말).
  await bridge.activate(project)
  await handlers.get(Channel.CHAT_SEND)?.({}, { query })
}

describe('원격 채널 — 실제 경로', () => {
  it('① 투영의 최종 글 = 스냅숏의 최종 content', async () => {
    const { bridge, remote, phone, projects } = await setup()
    await watching(remote, phone, ['a'])
    await send(bridge, projects[0]!, 'A 에게')

    await vi.waitFor(() => expect(lastSnapshotText('a')).toContain('답: A 에게'))
    const rebuilt = rebuild(phone, 'a')
    expect([...rebuilt.values()].join('')).toBe(lastSnapshotText('a'))
    await bridge.dispose()
  })

  it('② A 를 구독한 휴대폰에 B 프레임이 0건이다', async () => {
    const { bridge, remote, phone, projects } = await setup()
    await watching(remote, phone, ['a'])

    // 둘을 같은 서버에 붙이고 **양쪽에서** 턴을 돌린다
    await send(bridge, projects[1]!, 'B 에게')
    await send(bridge, projects[0]!, 'A 에게')
    await vi.waitFor(() => expect(lastSnapshotText('a')).toContain('답: A 에게'))
    await vi.waitFor(() => expect(lastSnapshotText('b')).toContain('답: B 에게'))

    const frames = phone.take()
    expect(frames.length).toBeGreaterThan(0)
    expect(frames.filter((frame) => 'projectId' in frame && frame.projectId === 'b')).toEqual([])
    expect(JSON.stringify(frames)).not.toContain('답: B 에게')
    await bridge.dispose()
  })

  it('④ 확장이 사용자 대화에 묻는 프레임은 휴대폰에 안 간다', async () => {
    const { bridge, remote, phone, projects } = await setup()
    await watching(remote, phone, ['a'])
    await bridge.activate(projects[0]!)
    phone.take()

    // `EXTENSION_CHAT_ASK` 는 `SessionBridge.push` 를 지나는 유일한 확장 프레임이다.
    // 확장 AI 세션(`opencode/extensionRun.ts`)은 확장 호스트로 가는 다른 길이라 여기 오지도 않는다.
    void bridge.ask('a', '확장이 물었다').catch(() => {})
    // **계측기가 정상인지 먼저 본다**: 화면은 그 프레임을 받았다. 안 받았다면 아래 0건은
    // 「필터가 막았다」가 아니라 「애초에 안 흘렀다」를 재는 것이 된다
    expect(sent.some((entry) => entry.channel === Channel.EXTENSION_CHAT_ASK)).toBe(true)
    expect(phone.take()).toEqual([])
    await bridge.dispose()
  })

  it('③ 원격이 꺼져 있으면 실제 턴이 돌아도 조각이 0건이다', async () => {
    const { bridge, remote, phone, projects } = await setup({ remoteEnabled: false })
    expect(await remote.attach(phone.link)).toBe(false)
    await send(bridge, projects[0]!, 'A 에게')
    await vi.waitFor(() => expect(lastSnapshotText('a')).toContain('답: A 에게'))
    expect(phone.fragmentCount).toBe(0)
    await bridge.dispose()
  })
})

describe('frameSink 추출 회귀 (계획 §9 P1 ⑥)', () => {
  it('미러가 붙어도 렌더러 팬아웃은 그대로다 — 겉봉·채널 전부', async () => {
    const { bridge, remote, phone, projects } = await setup()
    await watching(remote, phone, ['a'])
    await send(bridge, projects[0]!, 'A 에게')
    await vi.waitFor(() => expect(lastSnapshotText('a')).toContain('답: A 에게'))

    const channels = new Set(sent.map((entry) => entry.channel))
    expect(channels).toContain(Channel.SESSION_STATE)
    expect(channels).toContain(Channel.TURN_EVENT)
    expect(channels).toContain(Channel.CHAT_SNAPSHOT)
    // 겉봉은 `ProjectScoped` 그대로 — 원격이 payload 를 만지지 않는다
    expect(sent.every((entry) => 'projectId' in entry.scoped && 'payload' in entry.scoped)).toBe(true)
    await bridge.dispose()
  })

  it('미러가 던져도 화면은 계속 받는다 — 휴대폰 버그가 채팅을 멈추지 않게', async () => {
    const { bridge, projects } = await setup({ mirror: 'throw' })
    await send(bridge, projects[0]!, 'A 에게')
    await vi.waitFor(() => expect(lastSnapshotText('a')).toContain('답: A 에게'))
    await bridge.dispose()
  })
})
