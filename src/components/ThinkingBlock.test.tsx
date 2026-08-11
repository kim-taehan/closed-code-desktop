// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ThinkingBlock } from './ThinkingBlock'

// 추론 블록 (DC-1030). 핵심은 **기본 접힘** — 추론이 길어도 답변이 묻히면 안 된다.

afterEach(cleanup)

describe('ThinkingBlock', () => {
  it('기본은 접혀 있고 본문이 보이지 않는다', () => {
    render(<ThinkingBlock content="긴 추론 내용" />)

    expect(screen.getByRole('button', { name: /추론/ }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('긴 추론 내용')).toBeNull()
  })

  it('누르면 펼쳐지고 다시 누르면 접힌다', () => {
    render(<ThinkingBlock content="긴 추론 내용" />)
    const toggle = screen.getByRole('button', { name: /추론/ })

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('긴 추론 내용')).toBeTruthy()

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('긴 추론 내용')).toBeNull()
  })

  it('마크다운으로 파싱하지 않고 원문 그대로 보인다', () => {
    // 스트리밍 중엔 코드펜스가 열린 채 도착한다 — 파서를 태우면 남은 본문이 통째로 먹힌다
    render(<ThinkingBlock content="# 제목 아님\n```\n안 닫힌 펜스" />)
    fireEvent.click(screen.getByRole('button', { name: /추론/ }))

    expect(screen.getByText(/# 제목 아님/)).toBeTruthy()
    expect(document.querySelector('h1')).toBeNull()
  })
})
