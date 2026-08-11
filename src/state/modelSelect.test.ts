import { describe, expect, it } from 'vitest'
import { buildModelMenuOptions, displayModel, isModelSwitcherEligible } from './modelSelect'
import { EMPTY_LLM_MODEL_STATE } from '../../shared/protocol/llmConfig'

// 모델 스위처 표시 규칙 — **fail-closed** 가 계약이다 (DC-1322, vscode 동일 판정).
// 근거(개인 LLM / 관리자 허용 목록) 없이 보이면, 고른 모델이 전송 단계에서 거부된다.

function state(source: 'personal' | 'project' | null, allowedModels: string[] = []) {
  return {
    ...EMPTY_LLM_MODEL_STATE,
    status: source === null ? null : { source, model: 'cur', providerType: '', baseUrl: '', allowedModels },
  }
}

describe('isModelSwitcherEligible — fail-closed', () => {
  it('personal 은 항상 뜬다 (목록은 라이브 조회)', () => {
    expect(isModelSwitcherEligible(state('personal'))).toBe(true)
  })

  it('project 는 allowed_models 가 있어야만 뜬다', () => {
    expect(isModelSwitcherEligible(state('project', ['a']))).toBe(true)
    expect(isModelSwitcherEligible(state('project', []))).toBe(false)
  })

  it('상태를 아직 모르면(미연결·미응답) 숨긴다', () => {
    expect(isModelSwitcherEligible(state(null))).toBe(false)
    expect(isModelSwitcherEligible(EMPTY_LLM_MODEL_STATE)).toBe(false)
  })
})

describe('buildModelMenuOptions', () => {
  it('현재 설정 모델을 맨 앞에 두고 그 항목이 기본(model=null)이다', () => {
    const options = buildModelMenuOptions(['b', 'cur', 'a'], 'cur')
    expect(options).toEqual([
      { model: null, label: 'cur' },
      { model: 'b', label: 'b' },
      { model: 'a', label: 'a' },
    ])
  })

  it('목록에 현재 모델이 없어도 맨 앞에 끼워 넣는다 — 기본으로 돌아가는 길은 항상 있다', () => {
    expect(buildModelMenuOptions(['a'], 'cur')[0]).toEqual({ model: null, label: 'cur' })
  })

  it('현재 모델을 모르면 목록 그대로 (전부 오버라이드 후보)', () => {
    expect(buildModelMenuOptions(['a', 'b'], '')).toEqual([
      { model: 'a', label: 'a' },
      { model: 'b', label: 'b' },
    ])
  })
})

describe('displayModel', () => {
  it('오버라이드가 있으면 그것, 없으면 현재 설정 모델', () => {
    expect(displayModel('x', 'cur')).toBe('x')
    expect(displayModel(null, 'cur')).toBe('cur')
    expect(displayModel(null, '')).toBe('모델')
  })
})
