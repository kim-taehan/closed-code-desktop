// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLang } from './useLang'
import { getCurrentLang, setCurrentLang, t } from '../i18n/messages'
import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/settings/appSettings'
import type { AppSettingsApi } from './useAppSettings'

// 언어 정본은 appSettings.language 다. 렌더 시 모듈 스토어에 반영하고,
// 바꾸면 설정 저장 경로(save)를 그대로 탄다.

afterEach(() => setCurrentLang('ko'))

function fakeApi(language: AppSettings['language'], save = vi.fn()): AppSettingsApi {
  return { value: { ...DEFAULT_SETTINGS, language }, save }
}

describe('useLang', () => {
  it('렌더 시 설정의 언어를 모듈 스토어에 반영한다 — t() 가 그 언어로 읽힌다', () => {
    renderHook(() => useLang(fakeApi('en')))
    expect(getCurrentLang()).toBe('en')
    expect(t('저장')).toBe('Save')
  })

  it('setLang 은 언어만 바꿔 설정을 저장한다 (나머지 필드 보존)', () => {
    const save = vi.fn()
    const api = fakeApi('ko', save)
    const { result } = renderHook(() => useLang(api))

    act(() => result.current.setLang('zh'))

    expect(save).toHaveBeenCalledWith({ ...api.value, language: 'zh' })
  })
})
