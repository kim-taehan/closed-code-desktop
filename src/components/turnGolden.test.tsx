// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { MessageList } from './MessageList'
import {
  describeStructure,
  meta,
  openMeta,
  resetFixtureIds,
  text,
  thinking,
  tool,
  user,
  countNodes,
} from './turnFixtures'

// ══════════════════════════════════════════════════════════════
//  골든 테스트 (설계 §9.2) — B8
//
//  고정된 메시지 배열을 흘려넣고 렌더 구조를 스냅샷으로 고정한다.
//  구조가 바뀌면 스냅샷이 깨져서 "언제 화면이 달라졌는지" 가 드러난다.
// ══════════════════════════════════════════════════════════════

beforeEach(resetFixtureIds)
afterEach(cleanup)

function structure(
  messages: Parameters<typeof MessageList>[0]['messages'],
  turnMetas: Parameters<typeof MessageList>[0]['turnMetas'],
  isStreaming = false,
): string {
  const { container } = render(
    <MessageList messages={messages} turnMetas={turnMetas} isStreaming={isStreaming} />,
  )
  return describeStructure(container.querySelector('.chat-messages')!)
}

describe('시나리오 1 — 텍스트만 있는 턴', () => {
  it('스텝이 0 이라 토글도 body 도 없고 답변만 남는다', () => {
    const output = structure([user('안녕'), text('안녕하세요', { semanticType: 'reply' })], meta())

    expect(output).toMatchInlineSnapshot(`
      "cc-user-message
      cc-turn-header.cc-turn-header--no-toggle
      cc-assistant-message.cc-rail-end"
    `)
  })
})

describe('시나리오 2 — 도구 하나', () => {
  it('단일 묶음이라 카운터가 없다', () => {
    const output = structure([tool('read_file', { done: true }), text('읽었습니다')], meta())

    expect(output).toContain('taz-area.taz-area--single')
    expect(output).not.toContain('taz-counter')
  })
})

describe('시나리오 3 — 연속 도구 셋', () => {
  it('진행 중이면 카운터가 진행 중 문구다', () => {
    const messages = [tool('read_file', { done: true }), tool('grep_search'), tool('edit_file')]
    const { container } = render(
      <MessageList messages={messages} turnMetas={openMeta()} isStreaming />,
    )

    expect(container.textContent).toContain('3개 작업 진행 중…')
  })

  it('모두 끝나면 완료 문구로 바뀐다', () => {
    const messages = [
      tool('read_file', { done: true }),
      tool('grep_search', { done: true }),
      tool('edit_file', { done: true }),
    ]
    const { container } = render(<MessageList messages={messages} turnMetas={meta()} isStreaming={false} />)

    expect(container.textContent).toContain('3개 작업 완료')
  })
})

describe('시나리오 4 — 도구 사이에 텍스트가 끼는 경우', () => {
  it('묶음이 둘로 쪼개진다', () => {
    const output = structure(
      [
        tool('read_file', { done: true }),
        text('중간 설명'),
        tool('grep_search', { done: true }),
        tool('edit_file', { done: true }),
        text('끝났습니다', { semanticType: 'reply' }),
      ],
      meta(),
    )

    expect(countNodes(output, 'taz-area')).toBe(2)
    expect(output).toMatchInlineSnapshot(`
      "cc-turn-header.cc-turn-header--clickable
        cc-turn-toggle
      cc-turn-body.cc-turn-body--expanded
        taz-area.taz-area--single
          taz-item
        cc-assistant-message
        taz-area.taz-area--group
          taz-counter
      cc-assistant-message.cc-rail-end"
    `)
  })
})

describe('시나리오 5 — reply 가 중간에 있는 턴', () => {
  it('reply 로 표시된 버블이 body 바깥으로 빠진다', () => {
    const output = structure(
      [
        text('계획입니다', { semanticType: 'plan' }),
        text('최종 답변', { semanticType: 'reply' }),
        text('덧붙임', { semanticType: 'reflection' }),
      ],
      meta(),
    )

    // 마지막 텍스트가 아니라 reply 표시된 것이 body 밖으로 나간다
    const lines = output.split('\n')
    const bodyEnd = lines.findIndex((line) => !line.startsWith(' ') && line.includes('cc-assistant-message'))
    expect(bodyEnd).toBeGreaterThan(0)
    expect(output).toContain('cc-turn-body')
  })
})

describe('시나리오 6 — 중단된 턴', () => {
  it('렌더 노드가 하나면 스텝이 0 이고 라벨이 붙는다', () => {
    const output = structure([text('작업 중', { interrupted: true })], meta({ terminal: false }))

    expect(output).toContain('cc-turn-header--no-toggle')
    expect(output).toContain('cc-interrupted-label')
  })

  it('렌더 노드가 둘 이상이면 라벨은 턴 뒤에 하나만 붙는다', () => {
    const output = structure(
      [tool('read_file', { done: true }), text('작업 중', { interrupted: true })],
      meta({ terminal: false }),
    )

    expect(countNodes(output, 'cc-interrupted-label')).toBe(1)
  })
})

describe('시나리오 7 — 렌더 가능 노드가 0인 턴', () => {
  it('헤더조차 그리지 않는다', () => {
    // 빈 텍스트만 있는 턴은 화면에 아무것도 남기지 않아야 한다.
    // 헤더만 남으면 내용 없는 유령 턴처럼 보인다 (vscode MessageList.tsx:460-461).
    const output = structure([text('   '), text('')], meta())

    expect(output).toBe('')
  })

  it('사용자 메시지는 남고 빈 턴만 사라진다', () => {
    const output = structure([user('질문'), text('   ')], meta())

    expect(output).toContain('cc-user-message')
    expect(output).not.toContain('cc-turn-header')
  })
})

describe('시나리오 8 — 승인으로 멈췄다 재개된 턴', () => {
  it('같은 turnId 라 한 턴으로 그려진다', () => {
    const output = structure(
      [
        tool('edit_file', { done: true }),
        text('수정했습니다', { semanticType: 'reply' }),
      ],
      meta({ durationMs: 4200, stepCount: 2 }),
    )

    expect(countNodes(output, 'cc-turn-header')).toBe(1)
  })
})

describe('시나리오 8 — 추론이 섞인 턴 (DC-1030)', () => {
  it('추론은 body 안에 접힌 블록으로 들어가고 답변만 밖에 남는다', () => {
    const output = structure([thinking('먼저 파일부터 보자'), text('답변입니다')], meta())

    expect(output).toContain('thinking-block')
    // 추론이 답변 자리를 차지하면 최종 답변이 접힌 body 로 밀려난다
    const lines = output.split('\n')
    const replyLine = lines.findIndex(
      (line) => !line.startsWith(' ') && line.includes('cc-assistant-message'),
    )
    expect(replyLine).toBeGreaterThan(0)
    // 추론 본문은 기본 접힘이라 구조에 텍스트가 노출되지 않는다
    expect(output).not.toContain('먼저 파일부터 보자')
  })

  it('추론만 있고 답변이 없어도 턴이 그려진다', () => {
    const output = structure([thinking('고민 중')], openMeta())
    expect(output).toContain('thinking-block')
  })
})

describe('턴 경계', () => {
  it('사용자 메시지가 끼면 턴이 나뉜다', () => {
    const output = structure(
      [
        user('첫 질문'),
        text('첫 답변', { turnId: 't1', semanticType: 'reply' }),
        user('둘째 질문'),
        text('둘째 답변', { turnId: 't2', semanticType: 'reply' }),
      ],
      [
        { turnId: 't1', terminal: true },
        { turnId: 't2', terminal: true },
      ],
    )

    expect(countNodes(output, 'cc-turn-header')).toBe(2)
    expect(countNodes(output, 'cc-user-message')).toBe(2)
  })
})
