// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitCommitBox } from './GitCommitBox'

afterEach(cleanup)

const NOOP = { onCommit: () => {}, onPush: () => {} }

describe('커밋 입력칸', () => {
  it('담긴 것이 없으면 커밋 버튼이 막힌다', () => {
    render(<GitCommitBox {...NOOP} hasStaged={false} canPush={false} busy={false} />)
    fireEvent.change(screen.getByPlaceholderText('커밋 메시지'), { target: { value: '메시지' } })

    expect((screen.getByText('커밋') as HTMLButtonElement).disabled).toBe(true)
  })

  it('메시지가 비면 커밋 버튼이 막힌다', () => {
    render(<GitCommitBox {...NOOP} hasStaged canPush={false} busy={false} />)
    expect((screen.getByText('커밋') as HTMLButtonElement).disabled).toBe(true)
  })

  it('담긴 것과 메시지가 있으면 커밋한다', () => {
    const onCommit = vi.fn()
    render(<GitCommitBox {...NOOP} onCommit={onCommit} hasStaged canPush={false} busy={false} />)
    fireEvent.change(screen.getByPlaceholderText('커밋 메시지'), { target: { value: '  고침  ' } })
    fireEvent.click(screen.getByText('커밋'))

    // 앞뒤 공백은 다듬어 보낸다
    expect(onCommit).toHaveBeenCalledWith('고침')
  })

  // 줄바꿈과 커밋을 가르는 자리 — Enter 만으로 커밋하면 여러 줄 메시지를 쓸 수 없다
  it('Cmd/Ctrl+Enter 로 커밋하고, 맨 Enter 로는 커밋하지 않는다', () => {
    const onCommit = vi.fn()
    render(<GitCommitBox {...NOOP} onCommit={onCommit} hasStaged canPush={false} busy={false} />)
    const input = screen.getByPlaceholderText('커밋 메시지')
    fireEvent.change(input, { target: { value: '고침' } })

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onCommit).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Enter', metaKey: true })
    expect(onCommit).toHaveBeenCalledWith('고침')
  })

  // 버튼이 막혀 있는 조건은 단축키에도 그대로 걸려야 한다 — 담긴 것이 없으면 커밋할 게 없다
  it('커밋할 수 없는 상태면 단축키도 통하지 않는다', () => {
    const onCommit = vi.fn()
    render(
      <GitCommitBox {...NOOP} onCommit={onCommit} hasStaged={false} canPush={false} busy={false} />,
    )
    const input = screen.getByPlaceholderText('커밋 메시지')
    fireEvent.change(input, { target: { value: '고침' } })

    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })

    expect(onCommit).not.toHaveBeenCalled()
  })

  it('올릴 게 없으면 푸시 버튼이 막힌다', () => {
    render(<GitCommitBox {...NOOP} hasStaged={false} canPush={false} busy={false} />)
    expect((screen.getByText('푸시') as HTMLButtonElement).disabled).toBe(true)
  })

  it('올릴 게 있으면 푸시할 수 있다', () => {
    const onPush = vi.fn()
    render(<GitCommitBox {...NOOP} onPush={onPush} hasStaged={false} canPush busy={false} />)
    fireEvent.click(screen.getByText('푸시'))
    expect(onPush).toHaveBeenCalled()
  })
})
