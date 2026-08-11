import { describe, expect, it } from 'vitest'
import { pruneToRecentCap, sortProjects, type ProjectRecord } from './projectRecord'

function project(id: string, lastOpenedAt: number, favorite = false): ProjectRecord {
  return { id, root: `/tmp/${id}`, name: id, favorite, lastOpenedAt }
}

describe('정렬', () => {
  it('즐겨찾기가 위로 온다', () => {
    const sorted = sortProjects([project('a', 300), project('b', 100, true)])
    expect(sorted.map((p) => p.id)).toEqual(['b', 'a'])
  })

  it('같은 등급 안에서는 최근 연 순이다', () => {
    const sorted = sortProjects([project('a', 100), project('b', 300), project('c', 200)])
    expect(sorted.map((p) => p.id)).toEqual(['b', 'c', 'a'])
  })

  it('원본을 건드리지 않는다', () => {
    const input = [project('a', 100), project('b', 300)]
    sortProjects(input)
    expect(input.map((p) => p.id)).toEqual(['a', 'b'])
  })
})

describe('최근 목록 상한', () => {
  it('상한을 넘으면 오래된 것부터 떨어진다', () => {
    const many = Array.from({ length: 5 }, (_, index) => project(`p${index}`, index))
    expect(pruneToRecentCap(many, 3).map((p) => p.id)).toEqual(['p4', 'p3', 'p2'])
  })

  // 설계 §4.5 — 세면 한동안 안 연 즐겨찾기가 조용히 사라져 즐겨찾기를 한 의미가 없어진다
  it('즐겨찾기는 아무리 오래돼도 밀려나지 않는다', () => {
    const projects = [
      project('오래된-즐겨찾기', 0, true),
      ...Array.from({ length: 5 }, (_, index) => project(`p${index}`, index + 1)),
    ]

    const kept = pruneToRecentCap(projects, 3).map((p) => p.id)
    expect(kept).toContain('오래된-즐겨찾기')
    expect(kept).toEqual(['오래된-즐겨찾기', 'p4', 'p3', 'p2'])
  })

  it('즐겨찾기는 상한 계산에 세지 않는다 — 일반 항목이 상한만큼 남는다', () => {
    const projects = [
      project('f1', 10, true),
      project('f2', 11, true),
      ...Array.from({ length: 4 }, (_, index) => project(`p${index}`, index)),
    ]

    const kept = pruneToRecentCap(projects, 2)
    expect(kept.filter((p) => p.favorite)).toHaveLength(2)
    expect(kept.filter((p) => !p.favorite)).toHaveLength(2)
  })

  it('상한 이하면 그대로 둔다', () => {
    const projects = [project('a', 1), project('b', 2)]
    expect(pruneToRecentCap(projects, 15)).toHaveLength(2)
  })
})
