// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectRail } from './ProjectRail'
import type { ProjectRecord } from '../../shared/projects/projectRecord'

// 프로젝트 칩 끌어 옮기기. 레일은 새 순서 전체를 올리고, 화면은 main 이 밀어 준 목록으로만 바뀐다.

afterEach(cleanup)

function project(id: string): ProjectRecord {
  return { id, root: `/r/${id}`, name: id, favorite: false, lastOpenedAt: 1 }
}

function renderRail(onReorder = vi.fn()) {
  render(
    <ProjectRail
      open={['p1', 'p2', 'p3'].map(project)}
      activeId="p1"
      statusOf={() => 'ready'}
      onActivate={() => {}}
      onClose={() => {}}
      onRename={() => {}}
      onReorder={onReorder}
      onPick={() => {}}
      onSearchFiles={() => {}}
      menu={{ onSettings: () => {}, onLogs: () => {} }}
    />,
  )
  return onReorder
}

const chip = (id: string) => screen.getByTitle(`${id} /r/${id}`) // title 의 줄바꿈은 질의에서 공백으로 접힌다

describe('프로젝트 칩 끌어 옮기기', () => {
  it('칩을 다른 칩에 놓으면 새 순서 전체를 올린다', () => {
    const onReorder = renderRail()
    fireEvent.dragStart(chip('p3'))
    fireEvent.dragOver(chip('p1'))
    fireEvent.drop(chip('p1'))
    expect(onReorder).toHaveBeenCalledWith(['p3', 'p1', 'p2'])
  })

  it('+ 버튼은 끌리지도 놓을 자리가 되지도 않는다', () => {
    const onReorder = renderRail()
    const add = screen.getByRole('button', { name: '프로젝트 열기' })
    expect(add.getAttribute('draggable')).not.toBe('true')
    fireEvent.dragStart(chip('p1'))
    expect(fireEvent.dragOver(add)).toBe(true)
    fireEvent.drop(add)
    expect(onReorder).not.toHaveBeenCalled()
  })

  it('이 줄에서 시작하지 않은 끌기는 받지 않는다 — 파일 탭에서 끌려온 것', () => {
    const onReorder = renderRail()
    expect(fireEvent.dragOver(chip('p2'))).toBe(true)
    fireEvent.drop(chip('p2'))
    expect(onReorder).not.toHaveBeenCalled()
  })

  // 입력칸에서 글자를 긁어 고르는 손짓이 칩 끌기로 먹히면 안 된다
  it('이름을 고치는 칩은 끌리지 않고, 편집을 접으면 다시 끌린다', () => {
    const onReorder = renderRail()
    fireEvent.doubleClick(screen.getByRole('tab', { name: 'p2' }))
    expect(chip('p2').getAttribute('draggable')).toBe('false')
    expect(chip('p1').getAttribute('draggable')).toBe('true')

    fireEvent.dragStart(chip('p2'))
    fireEvent.dragOver(chip('p1'))
    fireEvent.drop(chip('p1'))
    expect(onReorder).not.toHaveBeenCalled()

    fireEvent.keyDown(screen.getByLabelText('프로젝트 이름'), { key: 'Escape' })
    expect(chip('p2').getAttribute('draggable')).toBe('true')
  })
})
