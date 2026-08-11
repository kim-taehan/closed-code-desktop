import { describe, expect, it } from 'vitest'
import { resolveSlashSubmission } from './slashCommands'

// 회귀 방지: 팝업은 2단계(DC-980)인데 **제출은 한 단계 matcher** 만 봤다.
// 팝업으로 고르면 canonical 로 되돌려 주니 드러나지 않았고, 손으로 치거나 이력에서
// 불러올 때만 터졌다 — UI 가 `/command ` 를 넣어 그 형식을 가르쳐 놓고서,
// `/command clear` 를 그대로 보내면 **그 줄이 통째로 LLM 에게 질문으로 갔다.**

describe('resolveSlashSubmission', () => {
  it('2단계 명령을 실행 대상으로 되돌린다', () => {
    const plan = resolveSlashSubmission('/command clear')
    expect(plan?.kind, '2단계 형식이 실행되지 않고 질문으로 나간다').toBe('run')
    if (plan?.kind !== 'run') return
    expect(plan.command.name).toBe('clear')
    expect(plan.args).toBe('')
  })

  it('2단계 명령의 인자를 그대로 넘긴다', () => {
    const plan = resolveSlashSubmission('/command rename 새 제목')
    expect(plan?.kind).toBe('run')
    if (plan?.kind !== 'run') return
    expect(plan.command.name).toBe('rename')
    expect(plan.args).toBe('새 제목')
  })

  it('예전 한 단계 형식도 그대로 받는다', () => {
    // 손에 익은 대로 쳐도 되어야 하고, 기존 대화 이력도 동작해야 한다
    const plan = resolveSlashSubmission('/clear')
    expect(plan?.kind).toBe('run')
    if (plan?.kind !== 'run') return
    expect(plan.command.name).toBe('clear')
  })

  it('2단계 스킬은 canonical 한 단계로 되돌려 런타임에 보낸다', () => {
    // 그대로 보내면 런타임이 `skill` 이라는 이름의 스킬을 찾는다
    expect(resolveSlashSubmission('/skill pptx 표지 만들어')).toEqual({
      kind: 'rewrite',
      text: '/pptx 표지 만들어',
    })
    expect(resolveSlashSubmission('/skill pptx')).toEqual({ kind: 'rewrite', text: '/pptx' })
  })

  it('카테고리만 친 것은 실행 대상이 아니다', () => {
    // `/command` 는 아직 고르는 중이다 — 실행하면 안 된다
    expect(resolveSlashSubmission('/command')).toBeNull()
    expect(resolveSlashSubmission('/skill')).toBeNull()
  })

  it('모르는 이름과 평범한 글은 건드리지 않는다', () => {
    expect(resolveSlashSubmission('/zzzz')).toBeNull()
    expect(resolveSlashSubmission('안녕하세요')).toBeNull()
  })
})
