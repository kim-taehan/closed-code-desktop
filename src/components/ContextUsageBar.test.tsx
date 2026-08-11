// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { ContextUsageBar } from './ContextUsageBar'
import type { TurnMeta } from '../../shared/ipc/messageTypes'

// 세션 컨텍스트 바 — 최신 턴의 사용량을 상시 표시한다 (DC-987/1019 대응).

afterEach(cleanup)

const META: TurnMeta = {
  turnId: 't1',
  tokens: {
    totalTokens: 30_000,
    contextLength: 141_000,
    contextUsageRatio: 0.18,
    lastInputTokens: 25_600,
    contextBreakdown: { systemPrompt: 8_000, conversation: 12_000, toolResults: 5_600 },
    usageWarningLevel: 'normal',
  },
}

describe('ContextUsageBar', () => {
  it('최신 턴의 사용량을 요약해 보인다', () => {
    render(<ContextUsageBar turnMetas={[META]} />)
    expect(screen.getByText(/25\.6K \/ 141\.0K \(18%\)/)).toBeDefined()
  })

  it('토큰 정보가 없으면 아무것도 그리지 않는다', () => {
    const { container } = render(<ContextUsageBar turnMetas={[{ turnId: 't1' }]} />)
    expect(container.firstChild).toBeNull()
  })

  it('누르면 카테고리 분해가 펼쳐진다', () => {
    render(<ContextUsageBar turnMetas={[META]} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('시스템 프롬프트')).toBeDefined()
    expect(screen.getByText('8.0K')).toBeDefined()
  })

  it('여러 턴이면 가장 최근에 기록된 토큰을 쓴다', () => {
    const older: TurnMeta = {
      turnId: 't0',
      tokens: { totalTokens: 1, contextLength: 141_000, contextUsageRatio: 0.01, lastInputTokens: 1_000 },
    }
    render(<ContextUsageBar turnMetas={[older, META]} />)
    expect(screen.getByText(/25\.6K/)).toBeDefined()
  })
})
