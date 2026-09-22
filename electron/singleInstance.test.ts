import { beforeEach, describe, expect, it, vi } from 'vitest'
import { claimSingleInstance } from './singleInstance'

// 앱은 무조건 하나만 뜬다 (singleInstance.ts). Electron 을 띄우지 않고 잠금 판정과 두 번째 실행 처리를 잠근다.

// vi.mock 은 호이스팅되므로 목이 쓰는 값도 vi.hoisted 로 먼저 만든다
const { handlers, app, window, getAllWindows } = vi.hoisted(() => {
  const handlers = new Map<string, () => void>()
  const app = {
    requestSingleInstanceLock: vi.fn(() => true),
    exit: vi.fn(),
    on: vi.fn((event: string, handler: () => void) => handlers.set(event, handler)),
  }
  const window = { isMinimized: vi.fn(() => true), restore: vi.fn(), show: vi.fn(), focus: vi.fn() }
  const getAllWindows = vi.fn((): unknown[] => [window])
  return { handlers, app, window, getAllWindows }
})
vi.mock('electron', () => ({ app, BrowserWindow: { getAllWindows: () => getAllWindows() } }))

beforeEach(() => {
  vi.clearAllMocks()
  handlers.clear()
})

describe('단일 인스턴스', () => {
  it('잠금을 못 잡은 두 번째 실행은 곧바로 끝나고 아무것도 걸지 않는다', () => {
    app.requestSingleInstanceLock.mockReturnValueOnce(false)

    expect(claimSingleInstance()).toBe(false)
    expect(app.exit).toHaveBeenCalledWith(0)
    expect(handlers.has('second-instance')).toBe(false)
  })

  it('첫 번째 실행은 계속 가고, 두 번째 실행이 오면 최소화된 창을 되살려 앞으로 가져온다', () => {
    expect(claimSingleInstance()).toBe(true)
    expect(app.exit).not.toHaveBeenCalled()

    handlers.get('second-instance')!()
    expect(window.restore).toHaveBeenCalled()
    expect(window.show).toHaveBeenCalled()
    expect(window.focus).toHaveBeenCalled()
  })

  it('창이 아직 없을 때 두 번째 실행이 와도 던지지 않는다', () => {
    getAllWindows.mockReturnValueOnce([])
    claimSingleInstance()
    expect(() => handlers.get('second-instance')!()).not.toThrow()
  })
})
