import { describe, expect, it } from 'vitest'
import { MessageKind, type ChatMessage, type TurnMeta } from './messageModel'
import { groupMessages, type ListEntry, type TurnEntry } from './turnGrouping'

// turnGrouping 은 평평한 메시지 배열을 턴 단위로 묶는다:
// user 는 항상 단독, 같은 turnId 연속 구간이 한 턴, turnId 없는 ERROR/SYSTEM/CODE_DIFF 는 단독,
// 나머지 turnId 없는 assistant 는 레거시 턴으로 묶되 ERROR/SYSTEM 을 만나면 끊는다.

function msg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { id: 'm', author: 'assistant', kind: MessageKind.TEXT, content: '내용', ...overrides }
}

function user(id: string): ChatMessage {
  return msg({ id, author: 'user', content: '질문' })
}

function turnEntry(entry: ListEntry | undefined): TurnEntry {
  if (!entry || entry.kind !== 'turn') throw new Error('turn 엔트리가 아님')
  return entry
}

describe('groupMessages — 기본 분기', () => {
  it('빈 배열은 빈 목록', () => {
    expect(groupMessages([])).toEqual([])
  })

  it('user 메시지는 단독으로 렌더된다', () => {
    const entries = groupMessages([user('u1')])
    expect(entries).toEqual([{ kind: 'single', msg: user('u1') }])
  })

  it('user 와 assistant 가 번갈아 오면 user 는 단독, assistant 는 턴', () => {
    const entries = groupMessages([user('u1'), msg({ id: 'a1', turnId: 't1' })])
    expect(entries[0]).toMatchObject({ kind: 'single' })
    expect(entries[1]).toMatchObject({ kind: 'turn', turnId: 't1' })
  })
})

describe('groupMessages — turnId 있는 턴', () => {
  it('같은 turnId 의 연속 assistant 를 한 턴으로 묶는다', () => {
    const entries = groupMessages([
      msg({ id: 'a', turnId: 't1' }),
      msg({ id: 'b', turnId: 't1', kind: MessageKind.TOOL_CALL, content: '' }),
    ])
    const turn = turnEntry(entries[0])
    expect(turn.messages.map((m) => m.id)).toEqual(['a', 'b'])
    expect(entries).toHaveLength(1)
  })

  it('turnId 가 바뀌면 별개의 턴으로 쪼갠다', () => {
    const entries = groupMessages([msg({ id: 'a', turnId: 't1' }), msg({ id: 'b', turnId: 't2' })])
    expect(entries.map((e) => (e as TurnEntry).turnId)).toEqual(['t1', 't2'])
  })

  it('턴 끝에 도달하면 경계로 turnEnded 를 참, isLastGroup 도 참', () => {
    const turn = turnEntry(groupMessages([msg({ id: 'a', turnId: 't1' })])[0])
    expect(turn.turnEnded).toBe(true)
    expect(turn.isLastGroup).toBe(true)
  })

  it('뒤에 user 가 오면 경계로 turnEnded 는 참이지만 isLastGroup 은 거짓', () => {
    const turn = turnEntry(groupMessages([msg({ id: 'a', turnId: 't1' }), user('u1')])[0])
    expect(turn.turnEnded).toBe(true)
    expect(turn.isLastGroup).toBe(false)
  })

  it('뒤에 다른 assistant 턴이 오면 경계 판정상 turnEnded 는 거짓', () => {
    // 경계가 assistant 라 boundaryEnded=false, meta 없음 → turnEnded=false
    const turn = turnEntry(groupMessages([msg({ id: 'a', turnId: 't1' }), msg({ id: 'b', turnId: 't2' })])[0])
    expect(turn.turnEnded).toBe(false)
  })

  it('meta.terminal 이 true 면 경계와 무관하게 턴이 끝난 것', () => {
    const metas = new Map<string, TurnMeta>([['t1', { turnId: 't1', terminal: true }]])
    const turn = turnEntry(groupMessages([msg({ id: 'a', turnId: 't1' }), msg({ id: 'b', turnId: 't2' })], metas)[0])
    expect(turn.turnEnded).toBe(true)
  })

  it('meta.terminal 이 false 면 끝에 있어도 턴이 안 끝난 것', () => {
    const metas = new Map<string, TurnMeta>([['t1', { turnId: 't1', terminal: false }]])
    const turn = turnEntry(groupMessages([msg({ id: 'a', turnId: 't1' })], metas)[0])
    expect(turn.turnEnded).toBe(false)
  })

  it('meta 는 있지만 terminal 이 미정이면 끝나지 않은 것으로 본다', () => {
    const metas = new Map<string, TurnMeta>([['t1', { turnId: 't1' }]])
    const turn = turnEntry(groupMessages([msg({ id: 'a', turnId: 't1' })], metas)[0])
    expect(turn.turnEnded).toBe(false)
  })
})

describe('groupMessages — turnId 없는 단독 렌더', () => {
  it('turnId 없는 ERROR 는 단독', () => {
    const entries = groupMessages([msg({ id: 'e', kind: MessageKind.ERROR, content: '오류' })])
    expect(entries[0]).toMatchObject({ kind: 'single' })
  })

  it('turnId 없는 SYSTEM 은 단독', () => {
    const entries = groupMessages([msg({ id: 's', kind: MessageKind.SYSTEM })])
    expect(entries[0]).toMatchObject({ kind: 'single' })
  })

  it('turnId 없는 CODE_DIFF 는 단독 (맨 앞일 때)', () => {
    const entries = groupMessages([msg({ id: 'c', kind: MessageKind.CODE_DIFF })])
    expect(entries[0]).toMatchObject({ kind: 'single' })
  })
})

describe('groupMessages — 레거시 턴 (turnId 없음)', () => {
  it('turnId 없는 TEXT 들을 레거시 턴으로 묶고 turnId 는 없다', () => {
    const entries = groupMessages([msg({ id: 'a' }), msg({ id: 'b', kind: MessageKind.TOOL_CALL, content: '' })])
    const turn = turnEntry(entries[0])
    expect(turn.turnId).toBeUndefined()
    expect(turn.messages.map((m) => m.id)).toEqual(['a', 'b'])
    expect(turn.turnEnded).toBe(true)
    expect(turn.isLastGroup).toBe(true)
  })

  it('레거시 묶음은 ERROR 를 만나면 끊기고, ERROR 는 별개의 단독으로 렌더된다', () => {
    const entries = groupMessages([msg({ id: 'a' }), msg({ id: 'e', kind: MessageKind.ERROR, content: '오류' })])
    expect(turnEntry(entries[0]).messages.map((m) => m.id)).toEqual(['a'])
    expect(entries[1]).toMatchObject({ kind: 'single' })
  })

  it('레거시 묶음은 SYSTEM 을 만나면 끊긴다', () => {
    const entries = groupMessages([msg({ id: 'a' }), msg({ id: 's', kind: MessageKind.SYSTEM })])
    expect(turnEntry(entries[0]).messages.map((m) => m.id)).toEqual(['a'])
    expect(entries[1]).toMatchObject({ kind: 'single' })
  })

  it('레거시 묶음 뒤에 CODE_DIFF 가 오면 같은 묶음으로 흡수된다 (ERROR/SYSTEM 만 끊음)', () => {
    // 맨 앞 CODE_DIFF 는 단독이지만, 레거시 TEXT 뒤의 CODE_DIFF 는 while 루프에서 안 끊겨 흡수된다.
    const entries = groupMessages([msg({ id: 'a' }), msg({ id: 'c', kind: MessageKind.CODE_DIFF })])
    expect(entries).toHaveLength(1)
    expect(turnEntry(entries[0]).messages.map((m) => m.id)).toEqual(['a', 'c'])
  })

  it('레거시 턴 뒤에 user 가 오면 turnEnded 참, isLastGroup 거짓', () => {
    const entries = groupMessages([msg({ id: 'a' }), user('u1')])
    const turn = turnEntry(entries[0])
    expect(turn.turnEnded).toBe(true)
    expect(turn.isLastGroup).toBe(false)
  })
})
