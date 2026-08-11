import type { Language } from '../../shared/settings/appSettings'
import { en } from './en'
import { zh } from './zh'

// UI 다국어. **한국어 원문 자체가 키다** — 별도 키를 발명하지 않는다.
//
// t('저장') 은 현재 언어의 번역을 돌려주고, 번역이 없으면 한국어 원문을 그대로 낸다.
// 그래서 아직 사전에 없는 문구도 최소한 한국어로는 보인다 (누락돼도 안전).
//
// 정본은 appSettings.language 다. useLang 이 렌더마다 setCurrentLang 으로 여기에 반영하고,
// 언어를 바꾸면 App 이 리렌더되며 그 렌더 패스의 t() 가 새 언어를 읽는다.

export type Lang = Language

/** 선택기 순서 = 이 순서. */
export const LANGS: readonly Lang[] = ['ko', 'en', 'zh']

/** 각 언어의 이름은 그 언어로 적는다 (번역하지 않는다). */
export const LANG_LABEL: Record<Lang, string> = {
  ko: '한국어',
  en: 'English',
  zh: '中文',
}

const DICTS: Record<Exclude<Lang, 'ko'>, Record<string, string>> = { en, zh }

let currentLang: Lang = 'ko'

export function setCurrentLang(lang: Lang): void {
  currentLang = lang
}

export function getCurrentLang(): Lang {
  return currentLang
}

/** 현재 언어의 번역. 한국어이거나 번역이 없으면 원문 그대로. */
export function t(ko: string): string {
  if (currentLang === 'ko') return ko
  return DICTS[currentLang][ko] ?? ko
}
