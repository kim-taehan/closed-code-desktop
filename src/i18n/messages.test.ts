import { afterEach, describe, expect, it } from 'vitest'
import { getCurrentLang, setCurrentLang, t } from './messages'

// 언어 전환. 현재 언어의 번역을 돌려주되, 없으면 한국어 원문으로 폴백한다.

afterEach(() => {
  setCurrentLang('ko') // 모듈 전역 상태라 테스트 간 격리
})

describe('t()', () => {
  it('기본은 한국어 — 원문을 그대로 돌려준다', () => {
    expect(getCurrentLang()).toBe('ko')
    expect(t('저장')).toBe('저장')
  })

  it("language='en' 이면 영어 번역", () => {
    setCurrentLang('en')
    expect(t('저장')).toBe('Save')
    expect(t('닫기')).toBe('Close')
  })

  it("language='zh' 이면 중국어 번역", () => {
    setCurrentLang('zh')
    expect(t('저장')).toBe('保存')
  })

  it('번역이 없는 문구는 한국어 원문으로 폴백한다', () => {
    setCurrentLang('en')
    expect(t('사전에 없는 문구입니다')).toBe('사전에 없는 문구입니다')
  })
})
