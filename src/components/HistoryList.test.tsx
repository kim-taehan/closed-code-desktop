// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HistoryList } from './HistoryList'
import type { ChatHistoryEntry } from '../../shared/protocol/chatHistory'

// 이력 목록이 잠그는 것.
//  1. 검색은 **서버에 묻는다** — 화면에서 `entries` 를 걸러 내지 않는다
//  2. 빈 대화는 접되 **조용히 사라지지 않는다** — 몇 개를 무슨 근거로 접었는지 줄로 말한다
//  3. 접는 근거는 **센 결과(`messageCount === 0`)** 다. 제목이 `New session - …` 이어도
//     세지 못한 대화는 안 접힌다

afterEach(cleanup)

function entry(patch: Partial<ChatHistoryEntry> = {}): ChatHistoryEntry {
  return { chatId: 'ses_1', title: '프로젝트 분석', updatedAt: '2026-08-15T10:00:00.000Z', ...patch }
}

function renderList(entries: ChatHistoryEntry[], onSearch = vi.fn()) {
  render(
    <HistoryList
      entries={entries}
      loading={false}
      onNewChat={() => {}}
      onSelect={() => {}}
      onRemove={() => {}}
      onSearch={onSearch}
    />,
  )
  return onSearch
}

describe('검색', () => {
  it('입력이 멎으면 그 낱말로 서버에 묻는다', async () => {
    vi.useFakeTimers()
    try {
      const onSearch = renderList([entry()])
      fireEvent.change(screen.getByLabelText('대화 제목 검색'), { target: { value: '인사' } })
      // 아직 안 나간다 — 글자마다 물으면 목록 질의가 타자 수만큼 늘어난다
      expect(onSearch).not.toHaveBeenCalled()
      vi.advanceTimersByTime(300)
      expect(onSearch).toHaveBeenCalledWith('인사')
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * ⚠️ **화면이 다시 거르면 안 된다.** 거르는 것은 서버이고(`GET /session?search=`),
   * 여기서 또 거르면 같은 낱말에 판정이 둘 생긴다 — 서버가 준 결과가 화면에서 사라진다.
   */
  it('받은 목록을 화면에서 다시 거르지 않는다', () => {
    vi.useFakeTimers()
    try {
      renderList([entry({ title: '빌드 실패' })])
      fireEvent.change(screen.getByLabelText('대화 제목 검색'), { target: { value: '인사' } })
      vi.advanceTimersByTime(300)
      expect(screen.getByText('빌드 실패')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('처음 뜨는 것만으로는 묻지 않는다 — 패널을 여는 쪽이 이미 물었다', () => {
    vi.useFakeTimers()
    try {
      const onSearch = renderList([entry()])
      vi.advanceTimersByTime(1000)
      expect(onSearch).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('빈 대화', () => {
  const EMPTY = entry({ chatId: 'ses_2', title: 'New session - 2026-08-16T00:04:52.896Z', messageCount: 0 })

  it('메시지 0건인 대화는 목록에서 접는다', () => {
    renderList([entry(), EMPTY])
    expect(screen.queryByText(EMPTY.title)).toBeNull()
    expect(screen.getByText('프로젝트 분석')).toBeTruthy()
  })

  /** 접는 것까지는 좋은데 **말없이** 접으면 사용자는 대화가 지워진 줄 안다. */
  it('몇 개를 무슨 근거로 접었는지 줄로 말하고, 눌러서 편다', () => {
    renderList([entry(), EMPTY])
    const toggle = screen.getByText(/메시지 0건인 대화 1개 보기/)
    fireEvent.click(toggle)
    expect(screen.getByText(EMPTY.title)).toBeTruthy()
  })

  /**
   * ⚠️ **제목으로 가르지 않는다.** 사용자가 `New session - …` 을 그대로 둔 진짜 대화가
   * 있을 수 있다. 어댑터가 세지 못한 대화는 `messageCount` 가 없고, 그건 「빈 대화」가
   * 아니라 「모른다」다.
   */
  it('제목이 New session 이어도 센 적이 없으면 안 접는다', () => {
    renderList([entry({ chatId: 'ses_3', title: 'New session - 2026-08-16T00:04:52.896Z' })])
    expect(screen.getByText('New session - 2026-08-16T00:04:52.896Z')).toBeTruthy()
    expect(screen.queryByText(/접기|보기/)).toBeNull()
  })
})
