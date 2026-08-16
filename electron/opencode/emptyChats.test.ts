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
   * ⚠️ **세는 단계를 걷어내려는 사람이 멈춰야 하는 자리다.**
   *
   * 시각만 보고 접었다면 진짜 대화가 사라지는 세션이 **실재한다** (실측 —
   * `opencode-local.db` 의 `ses_203ceefa5ffeuY0eTackOMPfkW`: `delta=0` 인데 메시지 2건,
   * 메시지가 세션 생성 +15ms·+17ms 에 들어왔는데 `time_updated` 가 안 움직였다).
   * 아래는 그 세션을 그대로 옮긴 것이고, **후보로 잡히되 접히지 않는** 것이 계약이다.
   */
  it('delta 가 0인데 메시지가 있는 세션 — 후보로 세되 접지 않는다', async () => {
    const fetchMessages = vi.fn(async () => [
      { info: { id: 'msg_dfc311069001', role: 'user' } },
      { info: { id: 'msg_dfc31106b003', role: 'assistant' } },
    ] as OpencodeMessage[])
    const empty = await verifyEmptyChats([session('ses_203ceefa5ffeuY0e')], fetchMessages)
    expect(fetchMessages).toHaveBeenCalledWith('ses_203ceefa5ffeuY0e')
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

  // 후보가 2289건이던 실측이 있다 (머리말 분포). 상한이 없으면 그만큼이 한 프레임에 뜬다.
  describe('팬아웃 상한', () => {
    /** 조회를 손으로 풀어 **동시에 몇 개가 떠 있는지** 잰다 */
    function gated(count: number) {
      const release: Array<() => void> = []
      let inflight = 0
      let peak = 0
      const asked: string[] = []
      const fetchMessages = async (id: string): Promise<OpencodeMessage[]> => {
        asked.push(id)
        inflight += 1
        peak = Math.max(peak, inflight)
        await new Promise<void>((resolve) => release.push(resolve))
        inflight -= 1
        return []
      }
      const sessions = Array.from({ length: count }, (_, index) => session(`ses_${index}`))
      return { sessions, fetchMessages, asked, drain: () => release.splice(0).forEach((fn) => fn()), peak: () => peak }
    }

    it('한꺼번에 8개까지만 띄운다', async () => {
      const g = gated(40)
      const done = verifyEmptyChats(g.sessions, g.fetchMessages)
      // 다 풀릴 때까지 돌린다 — 매번 최대 8개만 떠 있어야 한다
      for (let round = 0; round < 40; round += 1) {
        await Promise.resolve()
        g.drain()
      }
      await done

      expect(g.peak()).toBeLessThanOrEqual(8)
      expect(g.peak()).toBeGreaterThan(1)
    })

    // ⚠️ **상한을 넣으면서 세는 단계를 걷어내면** 그날 진짜 대화가 사라진다
    // (`looksEmpty` 의 반례). 후보는 하나도 빠짐없이 세어져야 한다.
    it('상한이 있어도 후보는 전부 센다', async () => {
      const g = gated(40)
      const done = verifyEmptyChats(g.sessions, g.fetchMessages)
      for (let round = 0; round < 40; round += 1) {
        await Promise.resolve()
        g.drain()
      }
      const empty = await done

      expect(g.asked).toHaveLength(40)
      expect(empty.size).toBe(40)
    })
  })
})
