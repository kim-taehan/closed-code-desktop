import { describe, expect, it } from 'vitest'
import { TurnMetaStore } from './turnMeta'

// turn_start / turn_end 메타 보관 (설계 §5.2). 상태 시퀀스 위주.

describe('TurnMetaStore — turn_start', () => {
  it('턴을 열고 startedAt 을 기록한다', () => {
    const store = new TurnMetaStore()
    store.onTurnStart('t1', 100)
    expect(store.active).toBe('t1')
    expect(store.get('t1')).toEqual({ turnId: 't1', startedAt: 100 })
  })

  it('startedAt 이 없으면 turnId 만 담는다', () => {
    const store = new TurnMetaStore()
    store.onTurnStart('t1')
    expect(store.get('t1')).toEqual({ turnId: 't1' })
  })

  it('빈 turnId 는 무시한다', () => {
    const store = new TurnMetaStore()
    store.onTurnStart('')
    expect(store.active).toBeNull()
    expect(store.snapshot()).toHaveLength(0)
  })

  it('같은 turnId 로 재개되면 최초 startedAt 을 유지한다', () => {
    const store = new TurnMetaStore()
    store.onTurnStart('t1', 100)
    store.onTurnStart('t1', 999)
    expect(store.get('t1')?.startedAt).toBe(100)
    expect(store.active).toBe('t1') // 재개해도 활성으로 복귀
  })

  it('다른 턴을 시작하면 활성 턴이 바뀐다', () => {
    const store = new TurnMetaStore()
    store.onTurnStart('t1')
    store.onTurnStart('t2')
    expect(store.active).toBe('t2')
  })
})

describe('TurnMetaStore — turn_end', () => {
  it('메타를 기록하고 terminal:true 에서만 활성 턴을 놓는다', () => {
    const store = new TurnMetaStore()
    store.onTurnStart('t1')

    store.onTurnEnd('t1', { durationMs: 900, stepCount: 3, terminal: false })
    expect(store.active).toBe('t1')
    expect(store.get('t1')).toMatchObject({ durationMs: 900, stepCount: 3, terminal: false })

    store.onTurnEnd('t1', { durationMs: 1500, terminal: true })
    expect(store.active).toBeNull()
    expect(store.get('t1')).toMatchObject({ durationMs: 1500, stepCount: 3, terminal: true })
  })

  it('빈 turnId 는 무시한다', () => {
    const store = new TurnMetaStore()
    store.onTurnEnd('', { terminal: true })
    expect(store.snapshot()).toHaveLength(0)
  })

  it('turn_start 없이 turn_end 가 와도 메타를 새로 만든다', () => {
    const store = new TurnMetaStore()
    store.onTurnEnd('t9', { durationMs: 42 })
    expect(store.get('t9')).toMatchObject({ turnId: 't9', durationMs: 42 })
  })

  it('활성 턴이 아닌 턴의 terminal 은 활성 턴을 건드리지 않는다', () => {
    const store = new TurnMetaStore()
    store.onTurnStart('t1')
    store.onTurnEnd('t2', { terminal: true })
    expect(store.active).toBe('t1')
  })

  it('부분 데이터는 있는 값만 덮어쓴다', () => {
    const store = new TurnMetaStore()
    store.onTurnStart('t1', 100)
    store.onTurnEnd('t1', { stepCount: 5 })
    expect(store.get('t1')).toMatchObject({ startedAt: 100, stepCount: 5 })
    expect(store.get('t1')?.durationMs).toBeUndefined()
  })
})

describe('TurnMetaStore — markTerminal / setTokens', () => {
  it('markTerminal 이 turn_end 없이도 종료를 확정한다', () => {
    const store = new TurnMetaStore()
    store.onTurnStart('t1')
    store.markTerminal('t1', true)
    expect(store.get('t1')?.terminal).toBe(true)
    expect(store.active).toBeNull()
  })

  it('markTerminal(false) 는 활성 턴을 놓지 않는다', () => {
    const store = new TurnMetaStore()
    store.onTurnStart('t1')
    store.markTerminal('t1', false)
    expect(store.active).toBe('t1')
  })

  it('markTerminal 은 없던 턴도 만든다', () => {
    const store = new TurnMetaStore()
    store.markTerminal('t7', true)
    expect(store.get('t7')).toEqual({ turnId: 't7', terminal: true })
  })

  it('빈 turnId 는 무시한다', () => {
    const store = new TurnMetaStore()
    store.markTerminal('', true)
    store.setTokens('', { totalTokens: 1 })
    expect(store.snapshot()).toHaveLength(0)
  })

  it('setTokens 는 토큰 사용량을 붙인다', () => {
    const store = new TurnMetaStore()
    store.onTurnStart('t1')
    store.setTokens('t1', { totalTokens: 1234, contextUsageRatio: 0.5 })
    expect(store.get('t1')?.tokens).toEqual({ totalTokens: 1234, contextUsageRatio: 0.5 })
  })

  it('setTokens 는 없던 턴도 만든다', () => {
    const store = new TurnMetaStore()
    store.setTokens('t3', { totalTokens: 5 })
    expect(store.get('t3')).toMatchObject({ turnId: 't3', tokens: { totalTokens: 5 } })
  })
})

describe('TurnMetaStore — snapshot / reset', () => {
  it('snapshot 은 모든 메타를 배열로 준다', () => {
    const store = new TurnMetaStore()
    store.onTurnStart('t1')
    store.onTurnStart('t2')
    expect(store.snapshot().map((m) => m.turnId)).toEqual(['t1', 't2'])
  })

  it('get 은 없는 턴에 undefined', () => {
    expect(new TurnMetaStore().get('없음')).toBeUndefined()
  })

  it('reset 은 모든 메타와 활성 턴을 지운다', () => {
    const store = new TurnMetaStore()
    store.onTurnStart('t1')
    store.reset()
    expect(store.snapshot()).toHaveLength(0)
    expect(store.active).toBeNull()
  })
})
