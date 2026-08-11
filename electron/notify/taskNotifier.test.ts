import { beforeEach, describe, expect, it, vi } from 'vitest'

// 알림은 **최신 하나만** 남는다. 여러 턴을 돌려 놓고 자리를 비우면
// 같은 문구("작업이 끝났습니다")가 알림 센터에 겹겹이 쌓였다 (실측).

const shown: FakeNotification[] = []

class FakeNotification {
  closed = false
  private handlers = new Map<string, () => void>()
  constructor(public options: { title: string; body: string; icon?: string }) {}
  on(event: string, handler: () => void): void {
    this.handlers.set(event, handler)
  }
  show(): void {
    shown.push(this)
  }
  close(): void {
    this.closed = true
    this.handlers.get('close')?.()
  }
}

vi.mock('electron', () => ({
  Notification: Object.assign(FakeNotification, { isSupported: () => true }),
  app: { getAppPath: () => '/app' },
}))

const window = { isDestroyed: () => false, isMinimized: () => false, focus: () => {}, restore: () => {} }

beforeEach(() => {
  shown.length = 0
  vi.resetModules()
})

describe('작업 완료 알림', () => {
  it('새 알림을 띄우기 전에 이전 것을 닫는다 — 쌓이지 않는다', async () => {
    const { showTaskDone } = await import('./taskNotifier')

    showTaskDone(window as never)
    showTaskDone(window as never)
    showTaskDone(window as never)

    expect(shown).toHaveLength(3)
    // 마지막 하나만 살아 있다
    expect(shown.map((notification) => notification.closed)).toEqual([true, true, false])
  })

  it('사용자가 닫은 뒤 다시 띄워도 문제 없다 — 사라진 것을 붙들지 않는다', async () => {
    const { showTaskDone } = await import('./taskNotifier')

    showTaskDone(window as never)
    shown[0]!.close()
    showTaskDone(window as never)

    expect(shown[1]!.closed).toBe(false)
  })

  it('어느 프로젝트인지 본문 앞에 붙는다 — 여러 개를 돌리면 어느 창인지 알 수 없다', async () => {
    const { showTaskDone } = await import('./taskNotifier')

    showTaskDone(window as never, { project: '프로젝트 2' })

    expect(shown[0]!.options.body).toBe('프로젝트 2 · 작업이 끝났습니다')
  })

  it('응답 대기일 때만 무엇을 기다리는지 덧붙인다 (툴 이름)', async () => {
    const { showTaskDone } = await import('./taskNotifier')

    showTaskDone(window as never, { kind: 'toolRequest', project: 'p1', detail: 'run_command' })
    showTaskDone(window as never, { kind: 'question', project: 'p1' })
    showTaskDone(window as never, { kind: 'plan', project: 'p1' })

    expect(shown[0]!.options.body).toBe('p1 · run_command 승인을 기다리고 있습니다')
    expect(shown[1]!.options.body).toBe('p1 · 질문에 답을 기다리고 있습니다')
    expect(shown[2]!.options.body).toBe('p1 · 계획 승인을 기다리고 있습니다')
  })

  it('앱 아이콘을 실어 보낸다 — 기본 Electron 아이콘이 뜨지 않게', async () => {
    const { showTaskDone } = await import('./taskNotifier')

    showTaskDone(window as never)

    expect(shown[0]!.options.icon).toContain('icon.png')
  })
})
