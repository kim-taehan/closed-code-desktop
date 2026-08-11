import { describe, expect, it } from 'vitest'
import { EMPTY_GIT_STATE, type GitFileEntry, type GitState } from './gitState'

// gitState 는 메인·렌더러가 공유하는 git 도메인 타입이다.
// 런타임 값은 EMPTY_GIT_STATE 하나뿐 — git 을 못 돌렸거나 저장소가 아닐 때의
// 안전한 시작점이다. 이 기본값이 어긋나면 첫 렌더가 "변경 있음"으로 잘못 뜬다.

describe('EMPTY_GIT_STATE', () => {
  it('저장소가 아니고 아무 변경도 없는 상태다', () => {
    expect(EMPTY_GIT_STATE).toEqual({
      isRepo: false,
      branch: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      staged: [],
      unstaged: [],
    })
  })

  it('선택 필드(error, fetchFailed)는 기본값에 없다', () => {
    expect(EMPTY_GIT_STATE.error).toBeUndefined()
    expect(EMPTY_GIT_STATE.fetchFailed).toBeUndefined()
  })

  it('staged/unstaged 는 서로 다른 빈 배열 인스턴스다', () => {
    expect(EMPTY_GIT_STATE.staged).not.toBe(EMPTY_GIT_STATE.unstaged)
  })

  it('스프레드로 파생 상태를 만들어도 원본이 오염되지 않는다', () => {
    const derived: GitState = { ...EMPTY_GIT_STATE, isRepo: true, branch: 'main' }
    expect(derived.isRepo).toBe(true)
    expect(derived.branch).toBe('main')
    expect(EMPTY_GIT_STATE.isRepo).toBe(false)
    expect(EMPTY_GIT_STATE.branch).toBeNull()
  })
})

// 줄 수·충돌 개수는 상태와 **다른 호출**에서 온다 (numstat·파일 스캔). 그래서 선택 필드다.
// 필수로 바꾸면 `gitStatus.ts` 가 만드는 항목이 전부 타입에서 터진다.
describe('GitFileEntry 의 수치 필드', () => {
  it('수치 없이도 유효한 항목이다 — 상태만 읽은 경로가 그렇다', () => {
    const entry: GitFileEntry = { path: 'a.txt', status: 'modified' }

    expect(entry.insertions).toBeUndefined()
    expect(entry.deletions).toBeUndefined()
    expect(entry.conflictCount).toBeUndefined()
  })

  // 0 은 "안 바뀜", 없음은 "모름"이다. 둘을 같게 다루면 바이너리에 `+0 −0` 이 뜬다.
  it('0 과 없음은 다른 값이다', () => {
    const counted: GitFileEntry = { path: 'a.txt', status: 'modified', insertions: 0, deletions: 0 }
    const unknown: GitFileEntry = { path: 'b.dat', status: 'modified' }

    expect(counted.insertions).toBe(0)
    expect(unknown.insertions).toBeUndefined()
    expect(counted.insertions === undefined).toBe(false)
  })

  it('충돌 개수를 실어도 다른 필드를 밀어내지 않는다', () => {
    const entry: GitFileEntry = { path: 'a.txt', status: 'conflicted', conflictCount: 2 }

    expect(entry).toEqual({ path: 'a.txt', status: 'conflicted', conflictCount: 2 })
  })
})
