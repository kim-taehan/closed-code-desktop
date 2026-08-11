import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/settings/appSettings'
import { setCurrentLang } from '../i18n/messages'

// 앱 전역 설정. main 이 정본이고 화면은 사본을 들고 있는다.
//
// 저장하면 **정규화된 값이 돌아온다** — 화면이 그 값으로 다시 그린다.
// 포트를 "99999" 로 넣으면 기본값으로 되돌아가는데, 그걸 화면이 알아야 한다.

export interface AppSettingsApi {
  value: AppSettings
  /** 저장 완료를 기다릴 수 있다 — 온보딩은 저장 뒤에야 재연결 순서가 맞는다 */
  save: (settings: AppSettings) => Promise<void>
}

export function useAppSettings(): AppSettingsApi {
  const [value, setValue] = useState<AppSettings>(DEFAULT_SETTINGS)

  // IPC 가 값을 안 돌려주면(핸들러 return 누락 등) 화면을 undefined 로 만들지 않는다 —
  // 렌더에서 value.* 를 읽다 흰 화면으로 죽는 것을 막는다.
  const accept = (next: AppSettings | undefined) => next && setValue(next)

  useEffect(() => {
    void window.davis.getSettings().then(accept)
  }, [])

  const save = useCallback(async (next: AppSettings) => {
    accept(await window.davis.setSettings(next))
  }, [])

  // UI 언어의 정본은 여기다. App 최상단에서 불려 자식들이 그려지기 전에 반영되므로,
  // 언어가 바뀌면(설정 저장→setValue) 그 렌더 패스의 t() 가 곧바로 새 언어를 읽는다.
  setCurrentLang(value.language)

  return { value, save }
}
