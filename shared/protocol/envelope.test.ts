import { describe, expect, it } from 'vitest'
import { Action, Kind } from './kinds'
import {
  createEnvelope,
  findDisallowedSnakeCaseKeys,
  parseInbound,
  serializeEnvelope,
} from './envelope'

describe('createEnvelope', () => {
  it('reqId 를 항상 채운다 — runtime 은 기본값 없이 필수로 받는다', () => {
    const envelope = createEnvelope(Kind.CHAT, Action.CHAT_REQUEST, { query: 'hello' })
    expect(envelope.reqId).toBeTruthy()
    expect(typeof envelope.reqId).toBe('string')
  })

  it('호출마다 다른 reqId 를 만든다', () => {
    const a = createEnvelope(Kind.CHAT, Action.CHAT_REQUEST, {})
    const b = createEnvelope(Kind.CHAT, Action.CHAT_REQUEST, {})
    expect(a.reqId).not.toBe(b.reqId)
  })

  it('선택 필드는 주어졌을 때만 넣는다', () => {
    const bare = createEnvelope(Kind.CHAT, Action.CHAT_REQUEST, {})
    expect('streamId' in bare).toBe(false)
    expect('chatId' in bare).toBe(false)

    const full = createEnvelope(Kind.CHAT, Action.STREAM_CANCEL, {}, { streamId: 's1', chatId: 'c1' })
    expect(full.streamId).toBe('s1')
    expect(full.chatId).toBe('c1')
  })
})

describe('findDisallowedSnakeCaseKeys', () => {
  it('중첩된 snake_case 키를 경로와 함께 찾는다', () => {
    const found = findDisallowedSnakeCaseKeys({
      data: { workspace: { workspace_path: '/tmp' } },
    })
    expect(found).toEqual(['data.workspace.workspace_path'])
  })

  it('배열 안쪽도 뒤진다', () => {
    const found = findDisallowedSnakeCaseKeys({
      data: { projects: [{ projectPath: '/a' }, { project_path: '/b' }] },
    })
    expect(found).toEqual(['data.projects[1].project_path'])
  })

  it('허용 목록의 snake_case 는 위반이 아니다', () => {
    // 이 셋은 runtime 에 별칭이 없어 오히려 snake_case 가 정답이다.
    expect(findDisallowedSnakeCaseKeys({ ping_id: 'abc' })).toEqual([])
    expect(findDisallowedSnakeCaseKeys({ data: { ide_type: 'desktop' } })).toEqual([])
    expect(findDisallowedSnakeCaseKeys({ data: { plugin_version: '0.1.0' } })).toEqual([])
  })

  it('camelCase 만 있으면 위반이 없다', () => {
    const envelope = createEnvelope(Kind.WORKSPACE, Action.WORKSPACE_SYNC, {
      workspace: { workspacePath: '/tmp', ideType: 'desktop' },
      projects: [],
    })
    expect(findDisallowedSnakeCaseKeys(envelope)).toEqual([])
  })
})

describe('serializeEnvelope', () => {
  it('정상 봉투를 JSON 으로 만든다', () => {
    const envelope = createEnvelope(Kind.CHAT, Action.CHAT_REQUEST, { query: 'hi' }, { reqId: 'r1' })
    expect(JSON.parse(serializeEnvelope(envelope))).toEqual({
      kind: 'chat',
      action: 'chat_request',
      reqId: 'r1',
      data: { query: 'hi' },
    })
  })

  it('허용되지 않은 snake_case 가 있으면 던진다 — 조용한 유실을 막는다', () => {
    const envelope = createEnvelope(Kind.WORKSPACE, Action.WORKSPACE_SYNC, {
      workspace: { workspace_path: '/tmp' },
    })
    expect(() => serializeEnvelope(envelope)).toThrow(/workspace_path/)
  })

  it('허용 목록 키가 있으면 던지지 않는다', () => {
    const envelope = createEnvelope(Kind.AUTH, Action.AUTH_REQUEST, {
      type: 'license_key',
      credentials: { licenseKey: 'k' },
      ide_type: 'desktop',
    })
    expect(() => serializeEnvelope(envelope)).not.toThrow()
  })
})

describe('parseInbound', () => {
  it('정상 프레임을 파싱한다', () => {
    const parsed = parseInbound('{"kind":"system","action":"connected","data":{"sessionId":"s"}}')
    expect(parsed?.kind).toBe('system')
    expect(parsed?.action).toBe('connected')
  })

  it('깨진 JSON 은 던지지 않고 null 을 준다', () => {
    expect(parseInbound('{ not json')).toBeNull()
  })

  it('kind/action 이 없으면 null 을 준다', () => {
    expect(parseInbound('{"foo":1}')).toBeNull()
    expect(parseInbound('null')).toBeNull()
    expect(parseInbound('"문자열"')).toBeNull()
  })
})
