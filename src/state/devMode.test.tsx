// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { matchDevPhrase, useDevPhrase } from './devMode'
import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/settings/appSettings'

// 개발자 모드 이스터에그 — 스펙 표(11_spec_devmode) 4행 그대로.
// 활성 문구는 김**다**은, 해제 문구는 김**도**은 — 한 글자 차이가 의도된 스펙이다.

describe('matchDevPhrase — 스펙 표', () => {
  it('일반 상태에서 활성 문구 → dev ON + "변경되었습니다"', () => {
    expect(matchDevPhrase('내가 김다은이다', false)).toEqual({
      next: true,
      reply: '개발자 모드로 변경되었습니다.',
    })
  })

  it('dev 상태에서 활성 문구 → 유지 + "이미 개발자 모드입니다"', () => {
    expect(matchDevPhrase('내가 김다은이다', true)).toEqual({
      next: true,
      reply: '이미 개발자 모드입니다',
    })
  })

  it('dev 상태에서 해제 문구 → dev OFF + "해제되었습니다"', () => {
    expect(matchDevPhrase('내가 김도은이다', true)).toEqual({
      next: false,
      reply: '개발자 모드가 해제되었습니다.',
    })
  })

  it('일반 상태에서 해제 문구 → 유지 + "나는 axgentic code 다"', () => {
    expect(matchDevPhrase('내가 김도은이다', false)).toEqual({
      next: false,
      reply: '나는 axgentic code 다',
    })
  })

  it('trim 후 정확 일치만 — 부분 포함·덧붙임은 이스터에그가 아니다', () => {
    expect(matchDevPhrase('  내가 김다은이다  ', false)?.next).toBe(true)
    expect(matchDevPhrase('내가 김다은이다!', false)).toBeNull()
    expect(matchDevPhrase('안녕, 내가 김다은이다', false)).toBeNull()
    expect(matchDevPhrase('내가 김다은이다 맞지', false)).toBeNull()
  })
})

describe('useDevPhrase — 가로채기와 저장', () => {
  const chatLocalNotice = vi.fn(() => Promise.resolve())

  beforeEach(() => {
    chatLocalNotice.mockClear()
    ;(window as unknown as { davis: unknown }).davis = { chatLocalNotice }
  })

  function run(text: string, value: AppSettings) {
    const save = vi.fn(() => Promise.resolve())
    const { result } = renderHook(() => useDevPhrase({ value, save }))
    return { intercepted: result.current(text), save }
  }

  it('이스터에그가 아니면 손대지 않는다 (false — 평소처럼 전송된다)', () => {
    const { intercepted, save } = run('안녕하세요', DEFAULT_SETTINGS)
    expect(intercepted).toBe(false)
    expect(chatLocalNotice).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  it('활성 문구면 로컬 응답을 남기고 developerMode=true 로 저장한다', () => {
    const { intercepted, save } = run('내가 김다은이다', DEFAULT_SETTINGS)
    expect(intercepted).toBe(true)
    expect(chatLocalNotice).toHaveBeenCalledWith({
      userText: '내가 김다은이다',
      noticeText: '개발자 모드로 변경되었습니다.',
    })
    expect(save).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, developerMode: true })
  })

  it('상태가 안 바뀌는 응답("이미"/"나는")은 저장하지 않는다', () => {
    const dev = { ...DEFAULT_SETTINGS, developerMode: true }
    expect(run('내가 김다은이다', dev).save).not.toHaveBeenCalled()
    expect(run('내가 김도은이다', DEFAULT_SETTINGS).save).not.toHaveBeenCalled()
    expect(chatLocalNotice).toHaveBeenCalledTimes(2)
  })

})
