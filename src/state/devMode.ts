import { useCallback } from 'react'
import type { AppSettings } from '../../shared/settings/appSettings'

// 개발자 모드 전환 이스터에그 (스펙: _workspace/11_spec_devmode.md).
//
// trim 후 **정확 일치**할 때만 반응하고, runtime 으로 보내지 않는다
// (ChatComposer 의 빌트인 슬래시 가로채기와 같은 계층).
// 활성 문구는 김**다**은, 해제 문구는 김**도**은 — 한 글자 차이가 의도된 스펙이다.

const DEV_ON_PHRASE = '내가 김다은이다'
const DEV_OFF_PHRASE = '내가 김도은이다'

export interface DevPhraseMatch {
  /** 적용할 다음 모드. 현재와 같으면 저장 없이 응답만 한다. */
  next: boolean
  /** 채팅에 남길 로컬 응답 (스펙 표 원문 그대로). */
  reply: string
}

/** 문구·현재 상태 → 응답과 다음 상태. 이스터에그가 아니면 null. */
export function matchDevPhrase(text: string, developerMode: boolean): DevPhraseMatch | null {
  const trimmed = text.trim()
  if (trimmed === DEV_ON_PHRASE) {
    return developerMode
      ? { next: true, reply: '이미 개발자 모드입니다' }
      : { next: true, reply: '개발자 모드로 변경되었습니다.' }
  }
  if (trimmed === DEV_OFF_PHRASE) {
    return developerMode
      ? { next: false, reply: '개발자 모드가 해제되었습니다.' }
      : { next: false, reply: '나는 closed code 다' }
  }
  return null
}

/**
 * 입력을 가로챈다. 이스터에그면 로컬 응답을 대화에 남기고 true (전송하지 않는다).
 */
export function useDevPhrase(settings: {
  value: AppSettings
  save: (next: AppSettings) => Promise<void>
}): (text: string) => boolean {
  const { value, save } = settings
  return useCallback(
    (text: string) => {
      const match = matchDevPhrase(text, value.developerMode)
      if (!match) return false
      void window.davis.chatLocalNotice({ userText: text.trim(), noticeText: match.reply })
      if (match.next !== value.developerMode) {
        const next = { ...value, developerMode: match.next }
        void save(next)
      }
      return true
    },
    [value, save],
  )
}
