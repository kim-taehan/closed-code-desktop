import { describe, expect, it, vi } from 'vitest'
import type { ProjectRecord } from '../../shared/projects/projectRecord'
import { cycleProject, projectAtIndex, projectNavigation } from './projectCycle'
import type { ProjectsApi } from './useProjects'

// 프로젝트 탭 전환 — 열린 순서대로, 양쪽으로 래핑.

function projects(...ids: string[]): ProjectRecord[] {
  return ids.map((id) => ({ id, root: `/tmp/${id}`, name: id, favorite: false, lastOpenedAt: 0 }))
}

const three = projects('a', 'b', 'c')

describe('cycleProject', () => {
  it('오른쪽은 다음, 왼쪽은 이전', () => {
    expect(cycleProject(three, 'a', 1)).toBe('b')
    expect(cycleProject(three, 'b', -1)).toBe('a')
  })

  it('끝에서 반대쪽으로 감긴다', () => {
    expect(cycleProject(three, 'c', 1)).toBe('a')
    expect(cycleProject(three, 'a', -1)).toBe('c')
  })

  it('탭이 하나뿐이면 옮겨 갈 곳이 없다', () => {
    expect(cycleProject(projects('a'), 'a', 1)).toBeNull()
  })

  it('활성이 없거나 목록에 없으면 아무 데도 가지 않는다', () => {
    expect(cycleProject(three, null, 1)).toBeNull()
    expect(cycleProject(three, 'zzz', 1)).toBeNull()
  })
})

// ⌘1..9 — 프로젝트 직행. 이게 없으면 탭이 서넛을 넘는 순간 순환으로만 가야 한다.
describe('projectAtIndex', () => {
  it('1-based 자리로 간다', () => {
    expect(projectAtIndex(three, 1)).toBe('a')
    expect(projectAtIndex(three, 3)).toBe('c')
  })

  // 크롬 관례 — 개수와 무관하게 끝으로 간다
  it('9 는 언제나 마지막이다', () => {
    expect(projectAtIndex(three, 9)).toBe('c')
    expect(projectAtIndex(projects('a'), 9)).toBe('a')
  })

  // **없는 자리를 마지막으로 눙치지 않는다.** 눙치면 ⌘5 와 ⌘6 이 같은 곳에 가서
  // "몇 번째" 라는 뜻 자체가 사라진다.
  it('자리가 없으면 아무 데도 가지 않는다', () => {
    expect(projectAtIndex(three, 4)).toBeNull()
    expect(projectAtIndex(three, 8)).toBeNull()
    expect(projectAtIndex([], 1)).toBeNull()
    expect(projectAtIndex([], 9)).toBeNull()
  })
})

describe('projectNavigation', () => {
  function api(open: ProjectRecord[], activeId: string | null, activate: (id: string) => void) {
    return { open, activeId, activate } as unknown as ProjectsApi
  }

  it('next/prev 가 옮겨 갈 프로젝트를 활성화한다', () => {
    const activate = vi.fn()
    projectNavigation(api(three, 'b', activate)).next()
    expect(activate).toHaveBeenCalledWith('c')
    projectNavigation(api(three, 'b', activate)).prev()
    expect(activate).toHaveBeenCalledWith('a')
  })

  it('탭이 하나뿐이면 부르지 않는다 — 헛된 전환을 보내지 않는다', () => {
    const activate = vi.fn()
    projectNavigation(api(projects('a'), 'a', activate)).next()
    expect(activate).not.toHaveBeenCalled()
  })

  it('at(n) 이 n번째를 활성화한다', () => {
    const activate = vi.fn()
    projectNavigation(api(three, 'a', activate)).at(2)
    expect(activate).toHaveBeenCalledWith('b')
  })

  it('빈 자리를 부르면 아무 일도 하지 않는다', () => {
    const activate = vi.fn()
    projectNavigation(api(three, 'a', activate)).at(7)
    expect(activate).not.toHaveBeenCalled()
  })
})
