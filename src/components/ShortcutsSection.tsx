// 설정 창의 "단축키".
//
// **실제로 등록된 것만 적는다.** 목록에 있는데 안 먹는 단축키는
// 없는 것보다 나쁘다 — 사용자는 자기가 잘못 눌렀다고 생각한다.
// 새 단축키를 만들 때 여기 한 줄을 함께 더한다.

import { t } from '../i18n/messages'
// 수식키 표기는 ⚙ 메뉴와 나눠 쓴다 (modKey.ts) — 판정을 복사하면 두 화면이 갈린다.
import { MOD, fmtKeys } from '../state/modKey'

interface Shortcut {
  keys: string
  what: string
  /** 어디서 먹는지. 창 전체인지 입력창 안인지가 다르다. */
  where: string
  /** 개발자 모드에서만 등록된다 — ⚙ 메뉴 항목·useShortcuts 의 onLogs 와 같은 조건. */
  dev?: boolean
}

const SHORTCUTS: { group: string; items: Shortcut[] }[] = [
  {
    group: '대화',
    items: [
      { keys: 'Enter', what: '보내기', where: '입력창' },
      { keys: 'Shift + Enter', what: '줄바꿈', where: '입력창' },
      { keys: 'Esc Esc', what: '입력 지우기 (두 번 연속)', where: '입력창' },
      { keys: 'Shift + Tab', what: '권한 모드 순환', where: '창 전체' },
    ],
  },
  {
    group: '입력 앞글자',
    items: [
      { keys: '!', what: '셸 실행 — LLM 을 거치지 않습니다', where: '입력창' },
      { keys: '@', what: '파일 참조 — 목록에서 고릅니다', where: '입력창' },
      { keys: '/', what: '스킬 — 목록에서 고릅니다', where: '입력창' },
    ],
  },
  {
    group: '찾기',
    items: [
      { keys: `${MOD} + P`, what: '파일 찾기', where: '창 전체' },
      { keys: `${MOD} + Shift + F`, what: '내용 검색', where: '창 전체' },
    ],
  },
  {
    // 크롬 탭 관례를 그대로 따른다 — 순환은 macOS 에서도 Ctrl (⌘+Tab 은 OS 앱 전환)
    group: '탭 (크롬 방식)',
    items: [
      { keys: 'Ctrl + Tab', what: '다음 탭 — 대화 → 파일들 → 로그 순환', where: '창 전체' },
      { keys: 'Ctrl + Shift + Tab', what: '이전 탭', where: '창 전체' },
      { keys: `${MOD} + W`, what: '탭 닫기 — 대화 탭에서는 무시 (창을 닫지 않습니다)', where: '창 전체' },
    ],
  },
  {
    group: '프로젝트 탭',
    items: [
      { keys: `${MOD} + Alt + →`, what: '다음 프로젝트', where: '창 전체' },
      { keys: `${MOD} + Alt + ←`, what: '이전 프로젝트', where: '창 전체' },
      { keys: `${MOD} + 1…9`, what: 'n번째 프로젝트로 바로 — 9 는 마지막', where: '창 전체' },
    ],
  },
  {
    group: '창',
    items: [
      { keys: `${MOD} + N`, what: '새 대화', where: '창 전체' },
      { keys: `${MOD} + ,`, what: '설정 열기', where: '창 전체' },
      { keys: `${MOD} + L`, what: '로그 보기', where: '창 전체', dev: true },
      { keys: 'Esc', what: '열린 메뉴·팝업 닫기', where: '창 전체' },
    ],
  },
]

export interface ShortcutsSectionProps {
  /** 개발자 모드 전용 단축키(⌘L)를 적을지. 등록되지 않은 것을 적지 않기 위한 판정이다. */
  developerMode: boolean
}

export function ShortcutsSection({ developerMode }: ShortcutsSectionProps) {
  return (
    <section className="dc-settings__section">
      <h3 className="dc-settings__heading">{t('단축키')}</h3>
      <p className="dc-settings__hint dc-settings__hint--above">
        {t('지금 동작하는 것만 적혀 있습니다.')}
      </p>

      {SHORTCUTS.map((section) => (
        <div key={section.group} className="dc-settings__field">
          <span className="dc-settings__label">{t(section.group)}</span>
          <table className="dc-keys">
            <tbody>
              {section.items.filter((item) => item.dev !== true || developerMode).map((item) => (
                <tr key={item.keys}>
                  <td className="dc-keys__key">
                    <kbd>{fmtKeys(item.keys)}</kbd>
                  </td>
                  <td className="dc-keys__what">{t(item.what)}</td>
                  <td className="dc-keys__where">{t(item.where)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  )
}
