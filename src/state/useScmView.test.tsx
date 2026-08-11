// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { hidesComposer, SCM_TAB, useScmView, type ScmViewHandle } from './useScmView'

// 소스 관리 탭 안의 선택. 프로젝트를 옮기면 앞 저장소에서 고른 파일·커밋이 남으면 안 된다
// (`useGitState` 의 "프로젝트 전환 시 즉시 비움" 과 같은 규칙).

afterEach(cleanup)

function mount(projectId: string | null) {
  const seen: { handle: ScmViewHandle | null } = { handle: null }
  function Probe({ id }: { id: string | null }) {
    seen.handle = useScmView(id)
    return null
  }
  const view = render(<Probe id={projectId} />)
  return {
    get handle() {
      if (seen.handle === null) throw new Error('훅이 아직 안 돌았다')
      return seen.handle
    },
    switchTo: (next: string | null) => view.rerender(<Probe id={next} />),
  }
}

describe('useScmView', () => {
  it('변경사항 갈래에서 시작하고 아무것도 안 골라 뒀다', () => {
    const probe = mount('p1')
    expect(probe.handle.view).toBe('changes')
    expect(probe.handle.file).toBeNull()
    expect(probe.handle.commit).toBeNull()
  })

  it('갈래·파일·커밋을 기억한다 — 탭 안에서 옮겨 다녀도 유지', () => {
    const probe = mount('p1')
    act(() => {
      probe.handle.selectView('history')
      probe.handle.selectFile('src/App.tsx')
      probe.handle.selectCommit('abc1234')
    })
    expect(probe.handle.view).toBe('history')
    expect(probe.handle.file).toBe('src/App.tsx')
    expect(probe.handle.commit).toBe('abc1234')
  })

  it('프로젝트가 바뀌면 셋 다 비운다 — 남의 저장소에서 고른 것이 남으면 안 된다', () => {
    const probe = mount('p1')
    act(() => {
      probe.handle.selectView('branches')
      probe.handle.selectFile('src/App.tsx')
      probe.handle.selectCommit('abc1234')
    })

    act(() => probe.switchTo('p2'))

    expect(probe.handle.view).toBe('changes')
    expect(probe.handle.file).toBeNull()
    expect(probe.handle.commit).toBeNull()
  })

  it('프로젝트를 닫아 없어져도(null) 비운다', () => {
    const probe = mount('p1')
    act(() => probe.handle.selectFile('src/App.tsx'))
    act(() => probe.switchTo(null))
    expect(probe.handle.file).toBeNull()
  })
})

describe('hidesComposer — 결정 #1', () => {
  it('소스 관리 탭에서만 감춘다 (자체 커밋바가 있다)', () => {
    expect(hidesComposer(SCM_TAB)).toBe(true)
  })

  it('대화·파일·로그 탭은 지금 동작 그대로 둔다', () => {
    expect(hidesComposer('chat')).toBe(false)
    expect(hidesComposer('logs')).toBe(false)
    expect(hidesComposer('/src/App.tsx')).toBe(false)
    // git diff 탭은 파일 탭이다 (diffTabKey — `git:staged:...`). 접두사가 같다고 감추면 안 된다
    expect(hidesComposer('git:staged:/src/App.tsx')).toBe(false)
  })
})
