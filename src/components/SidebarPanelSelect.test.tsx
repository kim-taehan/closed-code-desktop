// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SidebarPanelSelect } from './SidebarPanelSelect'

afterEach(cleanup)

describe('사이드바 패널 선택기', () => {
  it('기본은 프로젝트다', () => {
    render(<SidebarPanelSelect panel="files" onChange={() => {}} />)
    expect(screen.getByRole('button').textContent).toContain('프로젝트')
  })

  it('닫혀 있으면 목록을 그리지 않는다', () => {
    render(<SidebarPanelSelect panel="files" onChange={() => {}} />)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('누르면 고를 수 있는 것을 펼친다', () => {
    render(<SidebarPanelSelect panel="files" onChange={() => {}} />)

    fireEvent.click(screen.getByRole('button'))
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      '프로젝트',
      '소스 관리',
      '채팅이력',
    ])
  })

  it('지금 보고 있는 것을 선택됨으로 표시한다', () => {
    render(<SidebarPanelSelect panel="history" onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button'))

    const [files, git, history] = screen.getAllByRole('option')
    expect(files!.getAttribute('aria-selected')).toBe('false')
    expect(git!.getAttribute('aria-selected')).toBe('false')
    expect(history!.getAttribute('aria-selected')).toBe('true')
  })

  it('소스 관리를 고르면 알린다', () => {
    const onChange = vi.fn()
    render(<SidebarPanelSelect panel="files" onChange={onChange} />)

    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText('소스 관리'))

    expect(onChange).toHaveBeenCalledWith('git')
  })

  it('고르면 알리고 목록을 닫는다', () => {
    const onChange = vi.fn()
    render(<SidebarPanelSelect panel="files" onChange={onChange} />)

    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText('채팅이력'))

    expect(onChange).toHaveBeenCalledWith('history')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('바깥을 누르면 닫힌다', () => {
    render(<SidebarPanelSelect panel="files" onChange={() => {}} />)

    fireEvent.click(screen.getByRole('button'))
    fireEvent.mouseDown(document.body)

    expect(screen.queryByRole('listbox')).toBeNull()
  })
})

describe('확장이 등록한 패널', () => {
  const PANELS = [
    { id: 'ext:sample-ext:sampleExt.results' as const, title: '파일 크기' },
    { id: 'ext:sample-ext:sampleExt.results' as const, title: '샘플 확장' },
  ]

  it('내장 3개 뒤에 붙는다 — 순서는 설치 목록 순서다', () => {
    render(<SidebarPanelSelect panel="files" extensionPanels={PANELS} onChange={() => {}} />)

    fireEvent.click(screen.getByRole('button'))
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      '프로젝트',
      '소스 관리',
      '채팅이력',
      '파일 크기',
      '샘플 확장',
    ])
  })

  it('확장이 없으면 내장 3개 그대로다 — 빈 구분선도 그리지 않는다', () => {
    const { container } = render(<SidebarPanelSelect panel="files" onChange={() => {}} />)

    fireEvent.click(screen.getByRole('button'))
    expect(screen.getAllByRole('option')).toHaveLength(3)
    expect(container.querySelector('.dc-panel-select__rule')).toBeNull()
  })

  it('고르면 확장 패널 id 로 알린다', () => {
    const onChange = vi.fn()
    render(<SidebarPanelSelect panel="files" extensionPanels={PANELS} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText('파일 크기'))

    expect(onChange).toHaveBeenCalledWith('ext:sample-ext:sampleExt.results')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('확장 패널을 보고 있으면 닫힌 상태에도 그 이름이 뜬다', () => {
    // 매니페스트가 준 제목이라 번역하지 않는다 — t() 를 태우면 사전에 없는 문구가
    // 다른 언어에서 조용히 한국어로 남는 것처럼 보인다.
    render(
      <SidebarPanelSelect
        panel="ext:sample-ext:sampleExt.results"
        extensionPanels={PANELS}
        onChange={() => {}}
      />,
    )

    expect(screen.getByRole('button').textContent).toContain('파일 크기')
  })

  it('펼칠 때 목록을 다시 받아온다 — 방금 설치한 확장이 여기 떠야 한다', () => {
    // 설치는 설정 창에서 하고 이 목록은 사이드바가 쥔다. 여는 순간 다시 묻지 않으면
    // 새로 깐 확장이 앱을 껐다 켜기 전까지 안 뜬다.
    const onOpen = vi.fn()
    render(<SidebarPanelSelect panel="files" onOpen={onOpen} onChange={() => {}} />)

    fireEvent.click(screen.getByRole('button'))
    expect(onOpen).toHaveBeenCalledTimes(1)

    // 닫을 때는 부르지 않는다 — 볼 것이 없는데 IPC 를 왕복시킬 이유가 없다
    fireEvent.click(screen.getByRole('button'))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
