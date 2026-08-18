import { describe, expect, it } from 'vitest'
import { treeKeyAction, visibleRows } from './fileTreeKeys'
import type { TreeChildren } from './useFileTree'

// 파일 트리의 화살표 조작 (IntelliJ 프로젝트 창과 같은 규칙).
//
// 화면 없이 잠근다 — 「지금 어디로 가야 하나」는 순수 판단이고, 그리기는 그 답을 따르기만 한다.

/**
 *   .gradle/        (펼침)
 *     9.4.1/        (펼침 · 비었다 — 읽었는데 아무것도 없다)
 *     vcs-1/        (접힘)
 *     file-system.probe
 *   .kotlin/        (펼침이라 표시돼 있으나 **아직 안 읽혔다**)
 *   build.gradle.kts
 */
const CHILDREN: TreeChildren = {
  '': [
    { path: '.gradle', name: '.gradle', isDirectory: true },
    { path: '.kotlin', name: '.kotlin', isDirectory: true },
    { path: 'build.gradle.kts', name: 'build.gradle.kts', isDirectory: false },
  ],
  '.gradle': [
    { path: '.gradle/9.4.1', name: '9.4.1', isDirectory: true },
    { path: '.gradle/vcs-1', name: 'vcs-1', isDirectory: true },
    { path: '.gradle/file-system.probe', name: 'file-system.probe', isDirectory: false },
  ],
  '.gradle/9.4.1': [],
} as unknown as TreeChildren

const EXPANDED = new Set(['.gradle', '.gradle/9.4.1', '.kotlin'])

const ROWS = visibleRows(CHILDREN, EXPANDED)

describe('보이는 줄만 오간다', () => {
  it('렌더 순서 그대로 납작해진다', () => {
    expect(ROWS.map((row) => row.path)).toEqual([
      '.gradle',
      '.gradle/9.4.1',
      '.gradle/vcs-1',
      '.gradle/file-system.probe',
      '.kotlin',
      'build.gradle.kts',
    ])
  })

  // 펼치기는 눌렀는데 아직 안 들어온 폴더가 있다 (`loading`). 그 안을 있다고 치면
  // 화살표가 화면에 없는 줄로 간다 — 사용자에게는 커서가 사라진 것으로 보인다.
  it('안 읽힌 폴더는 자식이 없다 — 접힌 것과 같이 다룬다', () => {
    expect(ROWS.some((row) => row.path.startsWith('.kotlin/'))).toBe(false)
  })

  it('접힌 폴더 안은 안 보인다', () => {
    expect(ROWS.some((row) => row.path.startsWith('.gradle/vcs-1/'))).toBe(false)
  })
})

describe('↑↓ 는 보이는 줄을 오르내린다', () => {
  it('아래로 가면 다음 줄, 위로 가면 앞 줄', () => {
    expect(treeKeyAction(ROWS, '.gradle', 'ArrowDown')).toEqual({ kind: 'move', path: '.gradle/9.4.1' })
    expect(treeKeyAction(ROWS, '.gradle/9.4.1', 'ArrowUp')).toEqual({ kind: 'move', path: '.gradle' })
  })

  it('끝에서는 아무 일도 안 한다 — 반대쪽으로 돌지 않는다', () => {
    expect(treeKeyAction(ROWS, 'build.gradle.kts', 'ArrowDown')).toBeNull()
    expect(treeKeyAction(ROWS, '.gradle', 'ArrowUp')).toBeNull()
  })

  // 폴더를 접으면 그 안에 있던 초점이 화면에서 사라진다. 그때 다음 화살표가 아무것도
  // 안 하면 트리가 멈춘 것으로 보인다 — 첫 줄로 데려와 다시 움직이게 한다.
  it('초점이 사라졌으면 첫 줄부터 다시 시작한다', () => {
    expect(treeKeyAction(ROWS, '.gradle/vcs-1/없어진것', 'ArrowDown')).toEqual({ kind: 'move', path: '.gradle' })
    expect(treeKeyAction(ROWS, null, 'ArrowDown')).toEqual({ kind: 'move', path: '.gradle' })
  })

  it('처음·끝으로 한 번에 간다', () => {
    expect(treeKeyAction(ROWS, '.kotlin', 'Home')).toEqual({ kind: 'move', path: '.gradle' })
    expect(treeKeyAction(ROWS, '.gradle', 'End')).toEqual({ kind: 'move', path: 'build.gradle.kts' })
  })
})

describe('→ 는 펼치거나 자식으로 들어간다', () => {
  it('접힌 폴더는 펼친다', () => {
    expect(treeKeyAction(ROWS, '.gradle/vcs-1', 'ArrowRight')).toEqual({ kind: 'expand', path: '.gradle/vcs-1' })
  })

  it('이미 펼친 폴더는 첫 자식으로 간다', () => {
    expect(treeKeyAction(ROWS, '.gradle', 'ArrowRight')).toEqual({ kind: 'move', path: '.gradle/9.4.1' })
  })

  // 뒤집기로 두면 여기서 폴더가 **접힌다** — 자식이 없어 「자식으로」가 안 되고 뒤집기만
  // 남기 때문이다. 방향키가 반대로 도는 셈이라 `expand` 로 뜻을 갈라 뒀다.
  it('펼쳐 뒀는데 빈 폴더면 접지 않는다', () => {
    expect(treeKeyAction(ROWS, '.gradle/9.4.1', 'ArrowRight')).toEqual({ kind: 'expand', path: '.gradle/9.4.1' })
  })

  it('파일에는 갈 곳이 없다', () => {
    expect(treeKeyAction(ROWS, 'build.gradle.kts', 'ArrowRight')).toBeNull()
  })
})

describe('← 는 접거나 부모로 올라간다', () => {
  it('펼친 폴더는 접는다', () => {
    expect(treeKeyAction(ROWS, '.gradle', 'ArrowLeft')).toEqual({ kind: 'collapse', path: '.gradle' })
  })

  it('파일에서는 부모 폴더로 — 깊이 들어갔다 한 번에 나오는 길이다', () => {
    expect(treeKeyAction(ROWS, '.gradle/file-system.probe', 'ArrowLeft')).toEqual({
      kind: 'move',
      path: '.gradle',
    })
  })

  it('접을 것도 올라갈 곳도 없으면 아무 일도 안 한다', () => {
    expect(treeKeyAction(ROWS, '.kotlin', 'ArrowLeft')).toBeNull()
  })
})

describe('Enter 는 누른 것과 같다', () => {
  it('폴더는 뒤집고, 파일은 연다', () => {
    expect(treeKeyAction(ROWS, '.gradle', 'Enter')).toEqual({ kind: 'toggle', path: '.gradle' })
    expect(treeKeyAction(ROWS, 'build.gradle.kts', 'Enter')).toEqual({ kind: 'open', path: 'build.gradle.kts' })
  })
})

// 다 삼키면 트리 안에서 Tab 도 글자 입력도 죽는다. 부르는 쪽은 `null` 로 그것을 가른다.
describe('우리 것이 아닌 키는 흘려보낸다', () => {
  it('글자·Tab 은 답이 없다', () => {
    for (const key of ['a', 'Tab', 'Escape', ' ']) {
      expect(treeKeyAction(ROWS, '.gradle', key)).toBeNull()
    }
  })

  it('줄이 하나도 없으면 아무 키에도 답하지 않는다', () => {
    expect(treeKeyAction([], null, 'ArrowDown')).toBeNull()
  })
})
