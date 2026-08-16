import { describe, expect, it, vi } from 'vitest'
import { verifyEmptyChats } from './emptyChats'
import type { OpencodeMessage, OpencodeSession } from './historyApi'

// 「빈 대화」 판정이 잠그는 것 — **한 방향으로만 센다** (`emptyChats.ts` 머리말).
//
// 여기서 틀리면 두 모양으로 샌다: 진짜 대화가 목록에서 접히거나(치명), 껍데기가 그냥
// 보이거나(성가심). 아래는 전부 앞엣것을 겨눈다.

/** 실측 모양 그대로 — `time` 은 epoch ms 이고 `tokens` 가 함께 온다. */
function session(id: string, patch: Partial<OpencodeSession> = {}): OpencodeSession {
  return { id, title: '대화', directory: '/proj', time: { created: 1786778000000, updated: 1786778000000 }, ...patch }
}

const spoken = { time: { created: 1786778000000, updated: 1786778147273 } }

describe('빈 대화 판정', () => {
  it('센 결과가 0건인 것만 빈 대화다', async () => {
    const empty = await verifyEmptyChats([session('ses_a')], async () => [])
    expect([...empty]).toEqual(['ses_a'])
  })

  /**
   * ⚠️ **이 자리가 이 파일의 이유다.** `tokens.input === 0` 인데 메시지가 있는 세션이
   * 실재한다 (사용자 서버 실측: 메시지 3건에 `tokens.input=0`). 토큰으로 갈랐다면
   * 여기서 진짜 대화가 「빈 대화」로 찍혀 목록에서 접힌다.
   */
  it('토큰이 0이어도 메시지가 있으면 빈 대화가 아니다', async () => {
    const messages = [{ info: { id: 'm1', role: 'user' } }] as OpencodeMessage[]
    const empty = await verifyEmptyChats([session('ses_a')], async () => messages)
    expect(empty.size).toBe(0)
  })

  /**
   * `time.updated` 는 메시지 없이도 움직인다 (`setModel`·`setAgent` 가 올린다 — 실측).
   * 그래서 후보 판정은 **건너뛰기 용도로만** 쓴다. 건너뛴 세션에는 딱지가 안 붙는다.
   * 반대 방향(delta=0 인데 메시지 있음)은 저장소 2550건에서 **0건**이다 (`emptyChats.ts`).
   */
  it('말이 오간 흔적이 있으면 세지도 않는다 — 조회를 아예 안 부른다', async () => {
    const fetchMessages = vi.fn(async () => [])
    const empty = await verifyEmptyChats([session('ses_a', spoken)], fetchMessages)
    expect(fetchMessages).not.toHaveBeenCalled()
    expect(empty.size).toBe(0)
  })

  it('후보만 센다 — 32건 중 후보 1건이면 조회도 1번이다', async () => {
    const fetchMessages = vi.fn(async () => [])
    const sessions = [session('ses_a', spoken), session('ses_b'), session('ses_c', spoken)]
    await verifyEmptyChats(sessions, fetchMessages)
    expect(fetchMessages.mock.calls).toEqual([['ses_b']])
  })

  /** 못 셌다는 이유로 접으면, 서버가 잠깐 흔들린 것만으로 진짜 대화가 사라진다. */
  it('조회가 실패하면 빈 대화로 찍지 않는다', async () => {
    const empty = await verifyEmptyChats([session('ses_a')], async () => {
      throw new Error('HTTP 500')
    })
    expect(empty.size).toBe(0)
  })
})
