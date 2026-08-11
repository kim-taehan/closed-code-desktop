import { useCallback } from 'react'
import type { AppSettingsApi } from './useAppSettings'
import { setCurrentLang, type Lang } from '../i18n/messages'

// UI 언어 상태. 테마(useTheme)와 같은 역할이되, 정본은 localStorage 가 아니라
// appSettings.language 다 — 저장은 설정 경로(SETTINGS_SET)를 그대로 탄다.
//
// 렌더 도중 setCurrentLang 으로 모듈 스토어에 반영하는 이유: 이렇게 해야
// 같은 렌더 패스에서 App 아래 자식들이 부르는 t() 가 올바른 언어를 읽는다.
// (effect 로 미루면 첫 페인트가 한 박자 늦게 바뀐다.)

export interface LangState {
  lang: Lang
  setLang: (lang: Lang) => void
}

export function useLang(settings: AppSettingsApi): LangState {
  const lang = settings.value.language
  setCurrentLang(lang)

  const setLang = useCallback(
    (next: Lang) => settings.save({ ...settings.value, language: next }),
    [settings],
  )

  return { lang, setLang }
}
