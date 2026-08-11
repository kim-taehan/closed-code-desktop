// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExtensionsPanel } from './ExtensionsPanel'
import type { ExtensionEntry } from '../state/extensionRows'

afterEach(cleanup)

const EMPTY = { extensions: [], skipped: [], rowsByView: {} }

/** 화면이 실제로 받는 모양. **매니페스트가 아니다** — main 이 쓰는 것만 추려서 보낸다. */
function entry(overrides: Partial<ExtensionEntry> = {}): ExtensionEntry {
  return { dir: '/ext/todo', name: 'todo', displayName: 'TODO 수집기', version: '0.1.0', enabled: true, ...overrides }
}

/** 뷰 하나를 얹은 확장. 표가 그려지는 최소 조건이다. */
function withView(name: string, viewId: string, title = '결과'): ExtensionEntry {
  return entry({
    dir: `/ext/${name}`,
    name,
    displayName: name,
    contributes: { views: [{ id: viewId, title, kind: 'table' }] },
  })
}

describe('빈 목록', () => {
  // "없습니다" 만 두면 어디에 복사해야 하는지 몰라 막다른 길이 된다
  it('하나도 없으면 설치 경로를 같이 알린다', () => {
    render(<ExtensionsPanel {...EMPTY} />)

    expect(screen.getByText(/설치된 확장이 없습니다/)).toBeTruthy()
    expect(screen.getByText(/desktop-extensions/)).toBeTruthy()
  })
})

describe('건너뛴 확장', () => {
  // 사유와 함께 건너뛰는 것이 이 체계의 검증 기준이다 — 화면에서 안 보이면 의미가 없다
  it('실린 것이 하나도 없어도 건너뛴 것과 사유를 보여준다', () => {
    render(
      <ExtensionsPanel
        {...EMPTY}
        skipped={[{ dir: '/ext/broken', reason: 'missing_main' }]}
      />,
    )

    expect(screen.queryByText(/설치된 확장이 없습니다/)).toBeNull()
    expect(screen.getByText('broken')).toBeTruthy()
    expect(screen.getByText('main 이 없습니다')).toBeTruthy()
  })

  it('모르는 사유도 감추지 않고 코드를 담아 보여준다', () => {
    render(<ExtensionsPanel {...EMPTY} skipped={[{ dir: '/ext/x', reason: 'brand_new' }]} />)

    expect(screen.getByText(/brand_new/).textContent).toBe('알 수 없는 사유 (brand_new)')
  })

  it('건너뛴 개수를 제목에 적는다', () => {
    render(
      <ExtensionsPanel
        {...EMPTY}
        skipped={[
          { dir: '/ext/a', reason: 'no_manifest' },
          { dir: '/ext/b', reason: 'invalid_json' },
        ]}
      />,
    )

    expect(screen.getByText('건너뜀').textContent).toBe('건너뜀 2')
  })
})

describe('설치된 확장', () => {
  it('이름과 버전을 보여준다', () => {
    render(<ExtensionsPanel {...EMPTY} extensions={[entry({ dir: '/ext/todo' })]} />)

    expect(screen.getByText('TODO 수집기')).toBeTruthy()
    expect(screen.getByText('0.1.0')).toBeTruthy()
  })

  it('선언한 명령을 누르면 그 id 로 알린다', () => {
    const onRunCommand = vi.fn()
    render(
      <ExtensionsPanel
        {...EMPTY}
        extensions={[
          entry({ dir: '/ext/todo', ...{
              contributes: { commands: [{ id: 'todo.scan', title: 'TODO 수집' }] },
            } }),
        ]}
        onRunCommand={onRunCommand}
      />,
    )

    fireEvent.click(screen.getByText('TODO 수집'))
    expect(onRunCommand).toHaveBeenCalledWith('todo.scan')
  })

  // 실행할 길이 없는데 버튼만 그려 두면 눌리지 않는 버튼이 남는다 (GitPanel 주석과 같은 판단)
  it('실행 경로가 없으면 명령 버튼을 그리지 않는다', () => {
    render(
      <ExtensionsPanel
        {...EMPTY}
        extensions={[
          entry({ dir: '/ext/todo', ...{
              contributes: { commands: [{ id: 'todo.scan', title: 'TODO 수집' }] },
            } }),
        ]}
      />,
    )

    expect(screen.queryByText('TODO 수집')).toBeNull()
  })
})

describe('결과 표', () => {
  it('행이 없으면 아직 결과가 없다고 말한다', () => {
    render(<ExtensionsPanel {...EMPTY} extensions={[withView('todo', 'todo.results')]} />)

    expect(screen.getByText('아직 결과가 없습니다.')).toBeTruthy()
  })

  it('첫 행의 키 순서로 열을 세우고 값을 채운다', () => {
    render(
      <ExtensionsPanel
        {...EMPTY}
        extensions={[withView('todo', 'todo.results')]}
        rowsByView={{
          'todo.results': [{ kind: 'TODO', file: 'a.ts', line: 3, text: '고치기' }],
        }}
      />,
    )

    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'kind',
      'file',
      'line',
      'text',
    ])
    expect(screen.getByText('a.ts')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
  })

  // 확장마다 행 모양이 다르다 — 한쪽 열을 다른 쪽에 들이밀면 빈 표가 된다
  it('열이 다른 두 확장을 각자의 열로 그린다', () => {
    render(
      <ExtensionsPanel
        {...EMPTY}
        extensions={[withView('todo', 'todo.results', '할 일'), withView('lint', 'lint.results', '검사')]}
        rowsByView={{
          'todo.results': [{ kind: 'TODO', file: 'a.ts' }],
          'lint.results': [{ rule: 'no-any', severity: 'high', where: 'b.ts:12' }],
        }}
      />,
    )

    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'kind',
      'file',
      'rule',
      'severity',
      'where',
    ])
    expect(screen.getByText('TODO')).toBeTruthy()
    expect(screen.getByText('no-any')).toBeTruthy()
    // 뷰 제목으로 어느 확장의 결과인지 가른다
    expect(screen.getByText('할 일')).toBeTruthy()
    expect(screen.getByText('검사')).toBeTruthy()
  })

  it('뒤쪽 행에만 있는 열도 세운다', () => {
    render(
      <ExtensionsPanel
        {...EMPTY}
        extensions={[withView('todo', 'todo.results')]}
        rowsByView={{ 'todo.results': [{ file: 'a.ts' }, { file: 'b.ts', note: '나중에' }] }}
      />,
    )

    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'file',
      'note',
    ])
  })

  it('행을 누르면 그 행을 그대로 넘긴다', () => {
    const onOpenRow = vi.fn()
    render(
      <ExtensionsPanel
        {...EMPTY}
        extensions={[withView('todo', 'todo.results')]}
        rowsByView={{ 'todo.results': [{ file: 'a.ts', line: 7 }] }}
        onOpenRow={onOpenRow}
      />,
    )

    fireEvent.click(screen.getByText('a.ts'))
    expect(onOpenRow).toHaveBeenCalledWith({ file: 'a.ts', line: 7 })
  })

  it('목록이 아주 길면 자르되 몇 개가 빠졌는지 알린다', () => {
    const many = Array.from({ length: 205 }, (_, index) => ({ file: `f-${index}.ts` }))
    render(
      <ExtensionsPanel
        {...EMPTY}
        extensions={[withView('todo', 'todo.results')]}
        rowsByView={{ 'todo.results': many }}
      />,
    )

    // 자르되 조용히 자르지 않는다 — 남은 수가 보이고, 눌러서 전부 펼칠 수 있다
    expect(screen.getByText(/외 5개/)).toBeTruthy()
  })

  // 아직 못 그리는 종류를 조용히 빼면 확장 개발자가 왜 안 나오는지 알 수 없다
  it('table 이 아닌 뷰는 못 그린다고 밝힌다', () => {
    render(
      <ExtensionsPanel
        {...EMPTY}
        extensions={[
          entry({ dir: '/ext/tree', ...{
              name: 'tree',
              contributes: { views: [{ id: 'tree.results', title: '트리', kind: 'tree' }] },
            } }),
        ]}
      />,
    )

    expect(screen.getByText('아직 그리지 못하는 화면입니다 (tree).')).toBeTruthy()
  })
})
