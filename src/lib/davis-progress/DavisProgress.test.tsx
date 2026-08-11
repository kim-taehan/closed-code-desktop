// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { DavisProgress } from './DavisProgress'

// 훅 + 표시부 결합 계약. DOM 구조와 클래스 이름은 styles.css 와의 약속이라
// 원본 vscode 판과 문자열이 정확히 같아야 한다.

const verbs = {
  suffix: ' 중...',
  thinking: ['생각하는'],
  crafting: ['엮는'],
  searching: ['뒤지는'],
  cooking: ['졸이는'],
  nature: ['자아내는'],
  playful: ['흥얼거리는'],
}

/** 50ms 클럭이 React 상태를 밀므로 타이머 전진을 act 로 감싼다 */
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

beforeEach(() => {
  vi.useFakeTimers()
  // 동사를 첫 항목으로 고정한다
  vi.spyOn(Math, 'random').mockReturnValue(0)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function renderProgress(props: Partial<Parameters<typeof DavisProgress>[0]> = {}) {
  return render(<DavisProgress running={true} mode="requesting" verbs={verbs} {...props} />)
}

describe('표시 지연', () => {
  it('300ms 전에는 아무것도 그리지 않는다', () => {
    const { container } = renderProgress()
    advance(250)
    expect(container.querySelector('.davis-progress')).toBeNull()
  })

  it('300ms 뒤에 나타난다', () => {
    const { container } = renderProgress()
    advance(300)
    expect(container.querySelector('.davis-progress')).toBeTruthy()
  })

  it('running 이 false 면 나타나지 않는다', () => {
    const { container } = renderProgress({ running: false })
    advance(1000)
    expect(container.querySelector('.davis-progress')).toBeNull()
  })

  it('mode 가 idle 이면 나타나지 않는다', () => {
    const { container } = renderProgress({ mode: 'idle' })
    advance(1000)
    expect(container.querySelector('.davis-progress')).toBeNull()
  })

  it('running 이 false 로 내려가면 사라진다', () => {
    const { container, rerender } = renderProgress()
    advance(300)
    expect(container.querySelector('.davis-progress')).toBeTruthy()

    rerender(<DavisProgress running={false} mode="requesting" verbs={verbs} />)
    expect(container.querySelector('.davis-progress')).toBeNull()
  })
})

describe('DOM 구조', () => {
  it('글리프(SVG 로고)와 동사 두 칸으로 이뤄진다', () => {
    const { container } = renderProgress()
    advance(300)

    const root = container.querySelector('.davis-progress')!
    expect(root.querySelector('.davis-progress__glyph')).toBeTruthy()
    expect(root.querySelector('.davis-progress__logo')).toBeTruthy()
    expect(root.querySelector('.davis-progress__logo-core')).toBeTruthy()
    expect(root.querySelectorAll('.davis-progress__logo-node')).toHaveLength(2)
    expect(root.querySelector('.davis-progress__verb')).toBeTruthy()
  })

  it('글리프에 status 역할이 붙는다', () => {
    const { container } = renderProgress()
    advance(300)

    const glyph = container.querySelector('.davis-progress__glyph')!
    expect(glyph.getAttribute('role')).toBe('status')
    expect(glyph.getAttribute('aria-label')).toBe('Processing indicator')
  })
})

describe('mode 클래스', () => {
  it('mode 가 클래스로 나간다', () => {
    const { container } = renderProgress({ mode: 'tool-use' })
    advance(300)
    expect(container.querySelector('.davis-progress--tool-use')).toBeTruthy()
  })

  it('mode 가 바뀌면 클래스도 바뀐다', () => {
    const { container, rerender } = renderProgress()
    advance(300)
    expect(container.querySelector('.davis-progress--requesting')).toBeTruthy()

    rerender(<DavisProgress running={true} mode="responding" verbs={verbs} />)
    expect(container.querySelector('.davis-progress--responding')).toBeTruthy()
    expect(container.querySelector('.davis-progress--requesting')).toBeNull()
  })
})

describe('문구', () => {
  it('힌트가 없으면 동사에 접미사를 붙여 쓴다', () => {
    const { container } = renderProgress()
    advance(300)
    expect(container.querySelector('.davis-progress__verb')!.textContent).toBe('생각하는 중...')
  })

  it('힌트가 있으면 힌트를 쓴다', () => {
    const { container } = renderProgress({ hint: '파일 읽는' })
    advance(300)
    expect(container.querySelector('.davis-progress__verb')!.textContent).toBe('파일 읽는 중...')
  })

  it('이미 진행형으로 끝나는 힌트에는 접미사를 겹쳐 붙이지 않는다', () => {
    const { container } = renderProgress({ hint: '파일 읽는 중...' })
    advance(300)
    expect(container.querySelector('.davis-progress__verb')!.textContent).toBe('파일 읽는 중...')
  })

  it('동사는 턴 내내 바뀌지 않는다', () => {
    const { container } = renderProgress()
    advance(300)
    const first = container.querySelector('.davis-progress__verb')!.textContent

    advance(5000)
    expect(container.querySelector('.davis-progress__verb')!.textContent).toBe(first)
  })
})

describe('정체', () => {
  it('3초가 지나면 stalled 클래스가 붙고 콜백이 온다', () => {
    const onStall = vi.fn()
    const { container } = renderProgress({ onStall })

    advance(3000)
    expect(container.querySelector('.davis-progress--stalled')).toBeTruthy()
    expect(onStall).toHaveBeenCalledTimes(1)
  })

  it('그 전에는 stalled 가 아니다', () => {
    const { container } = renderProgress()
    advance(2950)
    expect(container.querySelector('.davis-progress--stalled')).toBeNull()
  })

  it('activityKey 가 바뀌면 정체 타이머가 되감긴다', () => {
    const onStall = vi.fn()
    const { container, rerender } = renderProgress({ onStall, activityKey: 1 })
    advance(2500)

    rerender(<DavisProgress running={true} mode="requesting" verbs={verbs} onStall={onStall} activityKey={2} />)
    advance(1000)

    expect(container.querySelector('.davis-progress--stalled')).toBeNull()
    expect(onStall).not.toHaveBeenCalled()
  })

  it('힌트가 오면 정체 타이머가 되감긴다', () => {
    const { container, rerender } = renderProgress({ hint: '첫 단계' })
    advance(2500)

    rerender(<DavisProgress running={true} mode="requesting" verbs={verbs} hint="다음 단계" />)
    advance(1000)

    expect(container.querySelector('.davis-progress--stalled')).toBeNull()
  })
})

describe('정리', () => {
  it('언마운트하면 클럭이 멈춘다', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
    const { unmount } = renderProgress()
    unmount()
    expect(clearIntervalSpy).toHaveBeenCalled()
  })
})
