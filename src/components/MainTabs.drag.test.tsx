// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MainTabs } from './MainTabs'
import type { OpenFile } from '../state/useOpenFiles'
import { useOpenFiles } from '../state/useOpenFiles'
import { tabCloseTargets } from '../state/tabCloseTargets'
import { cycleTab } from '../state/tabCycle'
import { SCM_TAB } from '../state/useScmView'

// 파일 탭 끌어 옮기기. 대화·로그·소스 관리 탭은 고정 자리다 (사용자 지시 — 대화 제외).
//
// jsdom 의 끌기 이벤트에는 `dataTransfer` 가 없다. 끄는 id 를 거기 싣는 구현이면 여기서
// 던지거나 조용히 빈다 — 구현이 컴포넌트 상태에 두는 것을 이 시험이 같이 잠근다.

afterEach(cleanup)

const FILES = ['a.ts', 'b.ts', 'c.ts'].map((path) => ({ path }) as OpenFile)
const NOOP = { onSelect: () => {}, onClose: () => {}, onCloseLogs: () => {}, onCloseScm: () => {} }

function renderTabs(onMove = vi.fn()) {
  render(<MainTabs {...NOOP} files={FILES} active="chat" logs scm onMove={onMove} />)
  return onMove
}

const tab = (path: string) => screen.getByTitle(path)
const fixed = (name: RegExp) => screen.getByRole('tab', { name }).closest('.main-tab') as HTMLElement

describe('파일 탭 끌어 옮기기', () => {
  it('파일 탭을 다른 파일 탭에 놓으면 옮긴다', () => {
    const onMove = renderTabs()
    fireEvent.dragStart(tab('a.ts'))
    fireEvent.dragOver(tab('c.ts'))
    fireEvent.drop(tab('c.ts'))
    expect(onMove).toHaveBeenCalledWith('a.ts', 'c.ts')
  })

  it('파일 탭만 끌린다 — 대화·로그·소스 관리는 아니다', () => {
    renderTabs()
    expect(tab('a.ts').getAttribute('draggable')).toBe('true')
    for (const name of [/대화/, /로그/, /소스 관리/]) expect(fixed(name).getAttribute('draggable')).not.toBe('true')
  })

  // 놓기를 허락하는 것은 dragover 의 preventDefault 다. 안 막히면 브라우저가 놓기를 거절한다
  it('고정 탭은 놓을 자리가 되지 않는다', () => {
    const onMove = renderTabs()
    fireEvent.dragStart(tab('a.ts'))
    for (const name of [/대화/, /로그/, /소스 관리/]) {
      expect(fireEvent.dragOver(fixed(name))).toBe(true)
      fireEvent.drop(fixed(name))
    }
    expect(onMove).not.toHaveBeenCalled()
    // 대조: 파일 탭 위에서는 막힌다 (=놓기 허락)
    expect(fireEvent.dragOver(tab('b.ts'))).toBe(false)
  })

  it('이 줄에서 시작하지 않은 끌기는 받지 않는다 — 프로젝트 칩·파일 트리에서 끌려온 것', () => {
    const onMove = renderTabs()
    expect(fireEvent.dragOver(tab('b.ts'))).toBe(true)
    fireEvent.drop(tab('b.ts'))
    expect(onMove).not.toHaveBeenCalled()
  })

  it('제자리에 놓거나 끌기를 접으면 아무것도 안 한다', () => {
    const onMove = renderTabs()
    fireEvent.dragStart(tab('a.ts'))
    fireEvent.drop(tab('a.ts'))
    fireEvent.dragStart(tab('b.ts'))
    fireEvent.dragEnd(tab('b.ts'))
    fireEvent.drop(tab('c.ts'))
    expect(onMove).not.toHaveBeenCalled()
  })

  it('끄는 탭과 놓을 자리를 표시하고, 끝나면 지운다', () => {
    renderTabs()
    fireEvent.dragStart(tab('a.ts'))
    fireEvent.dragOver(tab('c.ts'))
    expect(tab('a.ts').className).toContain('main-tab--dragging')
    expect(tab('c.ts').className).toContain('main-tab--drop-target')
    fireEvent.dragEnd(tab('a.ts'))
    expect(document.querySelector('.main-tab--dragging, .main-tab--drop-target')).toBeNull()
  })

  it('onMove 가 없으면 끌리지 않는다', () => {
    render(<MainTabs {...NOOP} files={FILES} active="chat" logs={false} />)
    expect(tab('a.ts').getAttribute('draggable')).toBe('false')
  })
})

// 순서를 렌더 단계에 따로 두면 화면만 바뀌고 좌/우 닫기·⌃Tab 은 옛 순서를 따른다
describe('옮긴 순서를 닫기·순환이 따른다', () => {
  it('move 가 files 배열 자체를 바꾼다', async () => {
    ;(window as unknown as { davis: unknown }).davis = {
      readFile: vi.fn().mockResolvedValue({ ok: true, text: '' }),
    }
    const { result } = renderHook(() => useOpenFiles('p1'))
    for (const path of ['a.ts', 'b.ts', 'c.ts']) await act(async () => result.current.open(path))

    act(() => result.current.move('a.ts', 'c.ts'))

    const files = result.current.files
    expect(files.map((file) => file.path)).toEqual(['b.ts', 'c.ts', 'a.ts'])
    expect(tabCloseTargets(files, 'c.ts')).toMatchObject({ left: ['b.ts'], right: ['a.ts'] })
    const paths = files.map((file) => file.path)
    expect(cycleTab({ active: 'c.ts', files: paths, logsOpen: false, direction: 1 })).toBe('a.ts')
    expect(cycleTab({ active: 'a.ts', files: paths, logsOpen: false, scmOpen: true, direction: 1 })).toBe(SCM_TAB)
  })
})
