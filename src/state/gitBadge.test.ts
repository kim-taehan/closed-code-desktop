import { describe, expect, it } from 'vitest'
import { EMPTY_GIT_STATE, type GitFileEntry, type GitState } from '../../shared/git/gitState'
import { buildBadges, hasChangesUnder, STATUS_LETTER } from './gitBadge'

// gitBadge 는 git 상태를 파일 트리·패널이 함께 쓰는 조회표로 좁힌다.
// 계약 두 가지:
//  1) 한 파일이 staged·unstaged 양쪽에 있으면(MM) 워크트리(unstaged) 쪽을 쓴다
//     — 트리는 디스크의 현재 모습을 보여주는 곳이기 때문이다.
//  2) hasChangesUnder 는 개수가 아니라 존재만 본다 — 틀린 수보다 침묵이 낫다.

function entry(path: string, status: GitFileEntry['status']): GitFileEntry {
  return { path, status }
}

function stateOf(staged: GitFileEntry[], unstaged: GitFileEntry[]): GitState {
  return { ...EMPTY_GIT_STATE, isRepo: true, staged, unstaged }
}

describe('STATUS_LETTER', () => {
  it('상태마다 한 글자를 갖는다', () => {
    expect(STATUS_LETTER).toEqual({
      modified: 'M',
      added: 'A',
      deleted: 'D',
      renamed: 'R',
      untracked: '?',
      conflicted: '!',
    })
  })
})

describe('buildBadges', () => {
  it('빈 상태면 빈 맵', () => {
    expect(buildBadges(EMPTY_GIT_STATE).size).toBe(0)
  })

  it('staged·unstaged 를 하나의 경로→상태 맵으로 합친다', () => {
    const badges = buildBadges(
      stateOf([entry('a.ts', 'added')], [entry('b.ts', 'modified')]),
    )
    expect(badges.get('a.ts')).toBe('added')
    expect(badges.get('b.ts')).toBe('modified')
    expect(badges.size).toBe(2)
  })

  it('양쪽에 있으면(MM) unstaged(워크트리) 쪽이 이긴다', () => {
    const badges = buildBadges(
      stateOf([entry('x.ts', 'added')], [entry('x.ts', 'modified')]),
    )
    expect(badges.get('x.ts')).toBe('modified')
    expect(badges.size).toBe(1)
  })

  it('없는 경로는 undefined', () => {
    expect(buildBadges(EMPTY_GIT_STATE).get('없음.ts')).toBeUndefined()
  })

  it('모든 상태 종류를 담을 수 있다', () => {
    const badges = buildBadges(
      stateOf(
        [entry('r.ts', 'renamed'), entry('d.ts', 'deleted')],
        [entry('u.ts', 'untracked'), entry('c.ts', 'conflicted')],
      ),
    )
    expect(badges.get('r.ts')).toBe('renamed')
    expect(badges.get('d.ts')).toBe('deleted')
    expect(badges.get('u.ts')).toBe('untracked')
    expect(badges.get('c.ts')).toBe('conflicted')
  })
})

describe('hasChangesUnder', () => {
  const badges = buildBadges(
    stateOf(
      [entry('src/state/a.ts', 'modified')],
      [entry('docs/readme.md', 'added')],
    ),
  )

  it('해당 폴더 아래에 변경이 있으면 true', () => {
    expect(hasChangesUnder(badges, 'src')).toBe(true)
    expect(hasChangesUnder(badges, 'src/state')).toBe(true)
    expect(hasChangesUnder(badges, 'docs')).toBe(true)
  })

  it('변경 없는 폴더면 false', () => {
    expect(hasChangesUnder(badges, 'test')).toBe(false)
    expect(hasChangesUnder(badges, 'src/other')).toBe(false)
  })

  it('빈 맵이면 항상 false', () => {
    expect(hasChangesUnder(new Map(), 'src')).toBe(false)
  })

  it('경로 경계(/ 접두)로만 매칭한다 — 형제 접두사에 새지 않는다', () => {
    const m = buildBadges(stateOf([entry('src-gen/a.ts', 'modified')], []))
    // 'src' 아래가 아니라 'src-gen' 아래다
    expect(hasChangesUnder(m, 'src')).toBe(false)
  })

  it('파일 경로 자체를 폴더로 줘도 그 파일은 자기 아래로 치지 않는다', () => {
    const m = buildBadges(stateOf([entry('a.ts', 'modified')], []))
    // 'a.ts/' 로 시작하는 키가 없으므로 false
    expect(hasChangesUnder(m, 'a.ts')).toBe(false)
  })

  it('중첩 폴더의 깊은 파일도 상위 폴더에서 잡힌다', () => {
    const m = buildBadges(stateOf([entry('a/b/c/deep.ts', 'added')], []))
    expect(hasChangesUnder(m, 'a')).toBe(true)
    expect(hasChangesUnder(m, 'a/b')).toBe(true)
    expect(hasChangesUnder(m, 'a/b/c')).toBe(true)
  })
})
