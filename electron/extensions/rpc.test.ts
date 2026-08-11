import { describe, expect, it } from 'vitest'
import {
  createNotice,
  createRequest,
  errorResponse,
  okResponse,
  parseFromChild,
  parseFromParent,
  parseRpcMessage,
  PendingRequests,
} from './rpc'

describe('rpc 봉투 파싱', () => {
  it('만든 것을 그대로 되읽는다', () => {
    const request = createRequest('host.ping', { n: 1 })
    expect(parseRpcMessage(request)).toEqual(request)
    expect(parseRpcMessage(createNotice('host.ready'))).toEqual({ kind: 'notice', method: 'host.ready' })
    expect(parseRpcMessage(okResponse('a', 7))).toEqual({ kind: 'response', id: 'a', ok: true, result: 7 })
    expect(parseRpcMessage(errorResponse('a', '실패'))).toEqual({
      kind: 'response',
      id: 'a',
      ok: false,
      error: '실패',
    })
  })

  it('형태가 아니면 던지지 않고 null 을 돌려준다', () => {
    for (const bad of [null, undefined, 7, '문자열', {}, { kind: '없는종류' }]) {
      expect(parseRpcMessage(bad)).toBeNull()
    }
  })

  it('필수 필드가 없으면 null 이다', () => {
    expect(parseRpcMessage({ kind: 'request', method: 'host.ping' })).toBeNull()
    expect(parseRpcMessage({ kind: 'request', id: 'a' })).toBeNull()
    expect(parseRpcMessage({ kind: 'response' })).toBeNull()
    expect(parseRpcMessage({ kind: 'notice' })).toBeNull()
  })

  it('ok 가 true 가 아닌 응답은 전부 실패로 좁힌다', () => {
    // 망가진 응답을 성공으로 통과시키면 부르는 쪽이 result 를 정상값으로 믿는다.
    expect(parseRpcMessage({ kind: 'response', id: 'a' })).toEqual({
      kind: 'response',
      id: 'a',
      ok: false,
      error: '알 수 없는 오류',
    })
    expect(parseRpcMessage({ kind: 'response', id: 'a', ok: 'true' })).toMatchObject({ ok: false })
  })

  it('params 가 없으면 키를 만들지 않는다', () => {
    expect(createNotice('host.shutdown')).not.toHaveProperty('params')
    expect(parseRpcMessage({ kind: 'notice', method: 'host.shutdown' })).not.toHaveProperty('params')
  })
})

describe('부모/자식 수신 비대칭', () => {
  const notice = createNotice('host.ready', { pid: 1 })

  it('자식은 event.data 에 싸서 받는다', () => {
    expect(parseFromParent({ data: notice })).toEqual(notice)
    // 껍질을 벗기지 않으면 undefined 를 만진다 — 그래서 벗기는 곳이 여기 하나여야 한다.
    expect(parseFromChild({ data: notice })).toBeNull()
  })

  it('부모는 껍질 없이 평평하게 받는다', () => {
    expect(parseFromChild(notice)).toEqual(notice)
    expect(parseFromParent({ data: undefined })).toBeNull()
  })
})

describe('요청 짝짓기', () => {
  it('id 로 응답을 짝지어 푼다', async () => {
    const pending = new PendingRequests()
    const answer = pending.track('a')
    expect(pending.settle(okResponse('a', 42))).toBe(true)
    await expect(answer).resolves.toBe(42)
  })

  it('짝이 없으면 false 를 돌려준다', () => {
    expect(new PendingRequests().settle(okResponse('없음'))).toBe(false)
  })

  it('한 번 푼 id 는 다시 풀리지 않는다', async () => {
    const pending = new PendingRequests()
    const answer = pending.track('a')
    pending.settle(okResponse('a', 1))
    await expect(answer).resolves.toBe(1)
    expect(pending.settle(okResponse('a', 2))).toBe(false)
  })

  it('rejectAll 이 남은 요청을 전부 거부한다', async () => {
    const pending = new PendingRequests()
    const first = pending.track('a')
    const second = pending.track('b')
    pending.rejectAll('호스트가 죽었습니다')

    await expect(first).rejects.toThrow('호스트가 죽었습니다')
    await expect(second).rejects.toThrow('호스트가 죽었습니다')
    // 비운 뒤라 뒤늦은 응답이 되살리지 못한다
    expect(pending.settle(okResponse('a', 1))).toBe(false)
  })
})
