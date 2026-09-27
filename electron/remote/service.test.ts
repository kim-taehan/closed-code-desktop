import { describe, expect, it } from 'vitest'
import { Channel } from '../../shared/ipc/channels'
import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/settings/appSettings'
import type { ProjectRecord } from '../../shared/projects/projectRecord'
import { FakePhone } from '../../tests/remote/MemoryLink'
import { RemoteService } from './service'

// 원격 서비스의 관문들 — 계획 §9 P1 ③(꺼짐)·§4-2 의 허용 목록·`mirror` 의 채널 필터.
//
// 프로젝트 격리(②)와 확장 프레임(④)은 실제 경로에서 재야 뜻이 있어 `remoteChannel.test.ts` 몫이다.

function projectOf(id: string): ProjectRecord {
  return { id, root: `/tmp/${id}`, name: id, favorite: false, lastOpenedAt: 0 }
}

function serviceWith(patch: Partial<AppSettings> = {}, projects = [projectOf('a'), projectOf('b')]) {
  const logs: string[] = []
  const service = new RemoteService({
    settings: () => Promise.resolve({ ...DEFAULT_SETTINGS, ...patch }),
    projects: () => projects,
    log: (line) => logs.push(line),
  })
  return { service, logs, phone: new FakePhone() }
}

/** 붙고 `hello` 까지 — 여기까지 와야 프로젝트 프레임이 흐른다 */
async function connected(patch: Partial<AppSettings> = { remoteEnabled: true }) {
  const kit = serviceWith(patch)
  expect(await kit.service.attach(kit.phone.link)).toBe(true)
  kit.phone.send({ t: 'hello', p: { protocol: 0, deviceName: '내 폰' } })
  kit.phone.take()
  return kit
}

describe('설정 관문 (계획 §9 P1 ③)', () => {
  it('기본값은 꺼짐이다 — 붙이지 않고 링크를 닫는다', async () => {
    const { service, phone, logs } = serviceWith()
    expect(DEFAULT_SETTINGS.remoteEnabled).toBe(false)
    expect(await service.attach(phone.link)).toBe(false)
    expect(phone.link.closed).toBe(true)
    expect(phone.fragmentCount).toBe(0)
    expect(logs.join()).toContain('원격 허용이 꺼져')
  })

  it('꺼져 있으면 프레임이 0건이다 — 미러를 두들겨도', async () => {
    const { service, phone } = serviceWith()
    await service.attach(phone.link)
    service.mirror(Channel.CHAT_SNAPSHOT, 'a', { messages: [], turnMetas: [], agentTasks: [] })
    service.mirror(Channel.TURN_EVENT, 'a', { type: 'turn_started', turnId: 't1' })
    expect(phone.fragmentCount).toBe(0)
  })

  it('켜져 있어도 hello 전에는 프로젝트 프레임이 0건이다 (§3-3 의 자리)', async () => {
    const { service, phone } = serviceWith({ remoteEnabled: true })
    expect(await service.attach(phone.link)).toBe(true)
    // **구독을 먼저 시킨다.** 구독이 없으면 투영 자체가 없어서 0건이 나오고, 그러면 이 시험은
    // hello 관문이 아니라 구독 필터를 재는 것이 된다 (되돌리기 시험이 그것을 잡았다).
    // 구독을 hello 전에 받는 것은 의도다 — 프레임이 안 나가므로 해가 없다.
    phone.send({ t: 'subscribe', p: { projectIds: ['a'] } })
    const before = phone.fragmentCount
    service.mirror(Channel.TURN_EVENT, 'a', { type: 'turn_started', turnId: 't1' })
    service.mirror(Channel.CHAT_SNAPSHOT, 'a', { messages: [], turnMetas: [], agentTasks: [] })
    expect(phone.fragmentCount).toBe(before)
  })

  it('승인 응답은 따로 꺼져 있다 — hello 가 그것을 알린다 (계획 §9 ⑩)', async () => {
    expect(DEFAULT_SETTINGS.remoteApprovals).toBe(false)
    const { service, phone } = serviceWith({ remoteEnabled: true })
    await service.attach(phone.link)
    phone.send({ t: 'hello', p: { protocol: 0, deviceName: '내 폰' } })
    expect(phone.take()[0]).toMatchObject({ t: 'hello', p: { approvalsAllowed: false } })
  })
})

describe('핸드셰이크와 구독 (§4-2)', () => {
  it('hello 에 hello·projects·ack 로 답한다 — root 는 싣지 않는다', async () => {
    const { service, phone } = serviceWith({ remoteEnabled: true, remoteApprovals: true })
    await service.attach(phone.link)
    phone.send({ t: 'hello', p: { protocol: 0, deviceName: '내 폰' } })
    const frames = phone.take()
    expect(frames.map((frame) => frame.t)).toEqual(['hello', 'projects', 'ack'])
    expect(frames[0]).toEqual({
      v: 0,
      t: 'hello',
      p: { protocol: 0, approvalsAllowed: true, maxMessageBytes: 262144 },
    })
    expect(JSON.stringify(frames[1])).not.toContain('/tmp/')
  })

  it('구독한 프로젝트만 흐른다', async () => {
    const { service, phone } = await connected()
    phone.send({ t: 'subscribe', p: { projectIds: ['a'] } })
    expect(phone.take().map((frame) => frame.t)).toEqual(['ack'])

    service.mirror(Channel.TURN_EVENT, 'a', { type: 'turn_started', turnId: 't1' })
    service.mirror(Channel.TURN_EVENT, 'b', { type: 'turn_started', turnId: 't2' })
    const frames = phone.take()
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({ t: 'turn', projectId: 'a' })
  })

  it('빈 배열로 구독하면 아무것도 안 받는다', async () => {
    const { service, phone } = await connected()
    phone.send({ t: 'subscribe', p: { projectIds: [] } })
    phone.take()
    service.mirror(Channel.TURN_EVENT, 'a', { type: 'turn_started', turnId: 't1' })
    expect(phone.take()).toEqual([])
  })

  it('열린 프로젝트가 아니면 unknown_project 로 거절한다', async () => {
    const { phone } = await connected()
    phone.send({ t: 'subscribe', id: 'c9', p: { projectIds: ['없는프로젝트'] } })
    expect(phone.take()).toEqual([
      { v: 0, t: 'reject', id: 'c9', projectId: '없는프로젝트', p: { code: 'unknown_project', message: '열린 프로젝트가 아닙니다' } },
    ])
  })

  it('sync 는 ack 뒤에 session·snapshot·pending 을 다시 보낸다', async () => {
    const { service, phone } = await connected()
    phone.send({ t: 'subscribe', p: { projectIds: ['a'] } })
    service.mirror(Channel.SESSION_STATE, 'a', { handshake: { stage: 'ready' }, connection: 'open' })
    phone.take()

    phone.send({ t: 'sync', projectId: 'a', p: {} })
    expect(phone.take().map((frame) => frame.t)).toEqual(['ack', 'session', 'snapshot', 'pending'])
  })

  it('구독하지 않은 프로젝트의 sync 는 거절한다', async () => {
    const { phone } = await connected()
    phone.send({ t: 'sync', projectId: 'a', p: {} })
    expect(phone.take()[0]).toMatchObject({ t: 'reject', p: { code: 'unknown_project' } })
  })
})

describe('허용 목록은 기본 거부다 (§4-2 · §4-3)', () => {
  // 허용 목록(§4-2)에 **있는데** 아직 안 연 단계다 — `not_yet` 이라야 한다. 휴대폰이 이 코드를
  // 받으면 나중에 열린다는 뜻이라 그 화면을 지우지 않는다. `not_allowed` 로 답하면 앱이 지운다.
  it.each([
    ['chat.send', { query: '휴대폰에서 보냄' }],
    ['cancel', {}],
    ['approval.respond', { requestId: 'r1', approved: true }],
    ['question.respond', { questionId: 'q1', answer: '네' }],
    ['plan.respond', { planId: 'p1', approved: true }],
  ])('%s 은 아직 안 연 단계라 not_yet 이다', async (t, p) => {
    const { phone } = await connected()
    phone.send({ t, projectId: 'a', p })
    expect(phone.take()[0]).toMatchObject({ t: 'reject', p: { code: 'not_yet' } })
  })

  // 목록 **밖**이라 영구히 안 열린다 (§4-3). 여기가 `not_yet` 로 새면 원격이 못 열 채널을
  // 「나중에 열린다」고 말하게 된다 — 막는 목록을 적지 않는 fail-closed 가 여기서 드러난다.
  it.each([
    ['session:start', {}],
    ['shell:run', { command: 'rm -rf /' }],
    ['permissionMode:set', { mode: 'yolo' }],
    ['history:remove', { id: 'h1' }],
  ])('%s 은 허용 목록 밖이라 not_allowed 다', async (t, p) => {
    const { phone } = await connected()
    phone.send({ t, projectId: 'a', p })
    expect(phone.take()[0]).toMatchObject({ t: 'reject', p: { code: 'not_allowed' } })
  })

  it('id 가 없으면 bad_frame 이다 — 상관 id 도 못 싣는다', async () => {
    const { phone } = await connected()
    phone.send({ t: 'subscribe', id: '', p: { projectIds: [] } })
    const reject = phone.take()[0]!
    expect(reject).toMatchObject({ t: 'reject', p: { code: 'bad_frame' } })
    expect('id' in reject).toBe(false)
  })

  it('JSON 이 아니면 bad_frame 이다', async () => {
    const { phone } = await connected()
    phone.sendRaw('이건 JSON 이 아니다')
    expect(phone.take()[0]).toMatchObject({ t: 'reject', p: { code: 'bad_frame' } })
  })

  it('판(v)이 다르면 거절한다 (§5)', async () => {
    const { phone } = await connected()
    phone.send({ v: 1, t: 'sync', projectId: 'a', p: {} })
    expect(phone.take()[0]).toMatchObject({ t: 'reject', p: { code: 'bad_frame' } })
  })
})

describe('미러 채널 필터', () => {
  it('§4-1 에 없는 채널은 흘리지 않는다 — 확장이 사용자 대화에 묻는 것 포함', async () => {
    const { service, phone } = await connected()
    phone.send({ t: 'subscribe', p: { projectIds: ['a'] } })
    phone.take()

    service.mirror(Channel.EXTENSION_CHAT_ASK, 'a', { askId: 'k1', query: '확장이 물었다' })
    service.mirror(Channel.NOTIFICATION, 'a', { message: '알림' })
    service.mirror(Channel.HISTORY_STATE, 'a', { entries: [], loading: false, loadingChatId: null, current: null })
    service.mirror(Channel.MCP_STATE, 'a', { servers: [] })
    service.mirror(Channel.PERMISSION_MODE_CHANGED, 'a', { mode: 'default' })
    expect(phone.take()).toEqual([])
  })
})

describe('끊기면 기억을 버린다', () => {
  it('detach 뒤에는 hello 부터 다시 해야 한다', async () => {
    const { service, phone } = await connected()
    phone.send({ t: 'subscribe', p: { projectIds: ['a'] } })
    phone.take()
    service.detach()

    const next = new FakePhone()
    expect(await service.attach(next.link)).toBe(true)
    service.mirror(Channel.TURN_EVENT, 'a', { type: 'turn_started', turnId: 't1' })
    expect(next.fragmentCount).toBe(0)
  })

  it('링크가 끊기면 서비스도 스스로 놓는다', async () => {
    const { service, phone } = await connected()
    phone.send({ t: 'subscribe', p: { projectIds: ['a'] } })
    const before = phone.fragmentCount
    phone.link.close()
    service.mirror(Channel.TURN_EVENT, 'a', { type: 'turn_started', turnId: 't1' })
    expect(phone.fragmentCount).toBe(before)
  })
})
