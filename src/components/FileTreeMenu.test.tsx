// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileTreeMenu, type FileTreeMenuExtra } from './FileTreeMenu'

// 확장이 얹은 항목이 **실제로 그려지는가.** 매니페스트 파싱과 자리 나누기가 둘 다 맞아도
// 여기서 안 그리면 화면에는 아무것도 없다 — 이 레포가 반복해 잡아 온 모양이다.

const extra: FileTreeMenuExtra = { extension: 'code-map', id: 'codeMap.reveal', title: '코드 지도에서 보기' }

afterEach(cleanup)

function draw(isDirectory = false) {
  const onRunExtra = vi.fn()
  const onDismiss = vi.fn()
  render(
    <FileTreeMenu
      x={0}
      y={0}
      isDirectory={isDirectory}
      onPick={() => {}}
      extras={[extra]}
      onRunExtra={onRunExtra}
      onDismiss={onDismiss}
    />,
  )
  return { onRunExtra, onDismiss }
}

describe('파일 트리 우클릭 메뉴 — 확장 항목', () => {
  it('확장 항목을 앱의 항목들보다 위에 그린다', () => {
    draw()
    const labels = screen.getAllByRole('menuitem').map((one) => one.textContent)

    expect(labels[0]).toBe('코드 지도에서 보기')
    expect(labels).toContain('휴지통으로')
  })

  it('누르면 그 명령을 알리고 메뉴를 닫는다', () => {
    const { onRunExtra, onDismiss } = draw()

    fireEvent.click(screen.getByRole('menuitem', { name: '코드 지도에서 보기' }))

    expect(onRunExtra).toHaveBeenCalledWith(extra)
    expect(onDismiss).toHaveBeenCalled()
  })

  /** 지금 이 자리를 쓰는 명령들은 파일 하나를 겨눈다 — 폴더에 띄우면 뜻이 없는 값이 간다 */
  it('폴더에는 안 뜬다', () => {
    draw(true)

    expect(screen.queryByRole('menuitem', { name: '코드 지도에서 보기' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: '휴지통으로' })).toBeTruthy()
  })

  /** 확장이 하나도 없으면 구분선만 남아 메뉴 위가 빈 줄로 뜬다 */
  it('확장 항목이 없으면 구분선도 안 그린다', () => {
    const { container } = render(
      <FileTreeMenu x={0} y={0} isDirectory={false} onPick={() => {}} onDismiss={() => {}} />,
    )

    expect(container.querySelector('.tab-menu__sep')).toBeNull()
  })
})
