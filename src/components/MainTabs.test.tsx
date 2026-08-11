// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MainTabs } from './MainTabs'
import type { OpenFile } from '../state/useOpenFiles'

// 본문 탭의 클릭 영역.
// 탭이 최소폭(110px)보다 라벨이 짧으면 빈 여백이 생기는데,
// 그 여백을 눌러도 전환돼야 한다 — 라벨 글자만 반응하면 "죽은 자리"가 된다.

afterEach(cleanup)

function file(path: string): OpenFile {
  return { path } as OpenFile
}

const NOOP = {
  onSelect: () => {},
  onClose: () => {},
  onCloseLogs: () => {},
}

describe('본문 탭 클릭 영역', () => {
  it('라벨 밖 여백을 눌러도 그 탭으로 전환한다', () => {
    const onSelect = vi.fn()
    render(
      <MainTabs {...NOOP} onSelect={onSelect} files={[file('/tmp/README.md')]} active="chat" logs={false} />,
    )

    // 라벨·× 버튼이 아니라 탭 컨테이너(span) 자체를 누른다
    const container = screen.getByTitle('/tmp/README.md')
    fireEvent.click(container)

    expect(onSelect).toHaveBeenCalledWith('/tmp/README.md')
  })

  it('× 를 누르면 닫기만 하고 전환하지 않는다 — 닫히는 탭을 활성화하면 안 된다', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(
      <MainTabs
        {...NOOP}
        onSelect={onSelect}
        onClose={onClose}
        files={[file('/tmp/README.md')]}
        active="chat"
        logs={false}
      />,
    )

    fireEvent.click(screen.getByTitle('닫기'))

    expect(onClose).toHaveBeenCalledWith('/tmp/README.md')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('로그 탭도 여백 클릭으로 전환한다', () => {
    const onSelect = vi.fn()
    render(<MainTabs {...NOOP} onSelect={onSelect} files={[]} active="chat" logs={true} />)

    const container = screen.getByText('로그').closest('.main-tab')!
    fireEvent.click(container)

    expect(onSelect).toHaveBeenCalledWith('logs')
  })

  it('소스 관리 탭은 열어 뒀을 때만 선다', () => {
    render(<MainTabs {...NOOP} files={[]} active="chat" logs={false} />)
    expect(screen.queryByText('⎇ 소스 관리')).toBeNull()

    cleanup()
    render(<MainTabs {...NOOP} files={[]} active="chat" logs={false} scm={true} />)
    expect(screen.getByText('⎇ 소스 관리')).toBeTruthy()
  })

  it('소스 관리 탭도 여백 클릭으로 전환하고 × 는 닫기만 한다', () => {
    const onSelect = vi.fn()
    const onCloseScm = vi.fn()
    render(
      <MainTabs
        {...NOOP}
        onSelect={onSelect}
        files={[]}
        active="chat"
        logs={false}
        scm={true}
        onCloseScm={onCloseScm}
      />,
    )

    fireEvent.click(screen.getByText('⎇ 소스 관리').closest('.main-tab')!)
    expect(onSelect).toHaveBeenCalledWith('git')

    onSelect.mockClear()
    fireEvent.click(screen.getByTitle('닫기'))
    expect(onCloseScm).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
  })
})
