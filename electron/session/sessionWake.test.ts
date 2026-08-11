import { describe, expect, it, vi } from 'vitest'
import { wakeConnection } from './sessionWake'

// 절전 복귀 시 소켓 처리. 실측(2026-07-29): 맥이 300초 자고 깨어난 그 초에
// runtime 이 ping watchdog 으로 끊었다. 우리 쪽은 여전히 open 이라고 믿고 있었다.

function conn(isOpen: boolean) {
  return { isOpen, recycle: vi.fn() }
}

describe('wakeConnection', () => {
  it('열려 있다고 믿는 소켓은 버리고 다시 붙는다', () => {
    const c = conn(true)
    expect(wakeConnection(c)).toBe(true)
    // close 가 아니라 recycle 이어야 한다 — close 는 수동 종료로 표시돼 재연결이 멈춘다
    expect(c.recycle).toHaveBeenCalledWith(4000, 'system resume')
  })

  it('이미 끊겼거나 재연결 중이면 건드리지 않는다', () => {
    // 기존 재연결 절차가 굴러가는 중이다. 여기서 끼어들면 백오프만 흐트러진다.
    const c = conn(false)
    expect(wakeConnection(c)).toBe(false)
    expect(c.recycle).not.toHaveBeenCalled()
  })

  it('세션이 아직 없으면 아무 일도 하지 않는다', () => {
    expect(wakeConnection(null)).toBe(false)
  })
})
