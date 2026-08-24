// 설정 창의 "단축키".
//
// **실제로 등록된 것만 적는다.** 목록에 있는데 안 먹는 단축키는
// 없는 것보다 나쁘다 — 사용자는 자기가 잘못 눌렀다고 생각한다.
// 새 단축키를 만들 때 여기 한 줄을 함께 더한다.
//
// ⚠️ **반대 방향으로도 어긋난다.** 화면은 "지금 동작하는 것만 적혀 있습니다" 라고
// 광고하는데(아래 `dc-settings__hint`), 실제로 도는 Esc(응답 중단)·⌘Enter(리뷰 적용)·
// ↑↓(입력 되짚기)·⌘↓⌘↑(셸 칸) 넷이 빠져 있었다. 빠진 것은 위 규칙만큼 나쁘지는 않지만
// 같은 약속을 깨는 일이라 함께 채웠다 — **적힌 것이 도는가**와 **도는 것이 적혔는가**는
// 둘 다 이 파일의 몫이다.
//
// `where` 는 실제 등록 범위와 맞춰야 한다. ⇧Tab 을 「창 전체」로 적어 뒀던 것이
// `PermissionModeSwitch` 가 창 전체를 가로채던 시절의 흔적이었다.

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
      // 「창 전체」였는데 실제로는 입력창 안에서만 먹는다 — 밖에서는 역방향 포커스 이동이다
      { keys: 'Shift + Tab', what: '권한 모드 순환', where: '입력창' },
      { keys: '↑ ↓', what: '이전에 보낸 입력 되짚기 — 첫 줄/끝 줄에서만', where: '입력창' },
    ],
  },
  {
    group: '응답 중',
    items: [
      { keys: 'Esc', what: '응답 중단', where: '창 전체' },
      { keys: `${MOD} + Enter`, what: 'turn 리뷰 전체 적용', where: '창 전체' },
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
      // ⚠️ **알려진 한계 — Win/Linux 에서 셸 칸에 포커스가 있으면 ⌃3·⌃4 로 프로젝트를
      // 옮길 수 없다.** 그 둘은 셸이 `ESC`·`FS` 로 실제로 쓰는 바이트라 뺏을 수 없다
      // (`src/state/drawerKeys.ts` 의 xterm 표). 칸을 나온 뒤(⌃↑) 쓰거나 ⌃1·⌃2·⌃9 를 쓴다.
      // **mac 은 ⌘ 라 해당 없음** — `belongsToApp` 이 ⌘ 조합을 전부 통과시킨다.
      //
      // 「그만큼 열리는 경우가 드물다」고 적었던 것은 **틀렸다.** ⌃3·⌃4 는 앞자리라
      // 늘 갈 자리가 있다. (이 단락이 처음 적힐 때는 `MAX_OPEN_PROJECTS = 4` 라
      // ⌃5~⌃8 은 갈 자리조차 없었는데, 상한이 10 이 되면서 그 여덟 칸 전부가 유효해졌다
      // — 한계의 무게가 오히려 늘었다.)
      //
      // `where` 는 「창 전체」로 둔다. 이 한계는 ⌃1..9 만의 것이 아니라 **⌃ 계열 창
      // 단축키 전반**의 성질이고(⌃W·⌃P·⌃N 도 칸 안에서는 셸로 간다), 그 행들에도 단서가
      // 없다. 한 행에만 붙이면 나머지가 안전한 것처럼 읽힌다 — 달려면 목록 전체에 한 줄로
      // 달아야 하는데, mac 에서는 전부 정상이라 그쪽 사용자에게는 없는 문제를 광고하게 된다.
      { keys: `${MOD} + 1…9`, what: 'n번째 프로젝트로 바로 — 9 는 마지막', where: '창 전체' },
    ],
  },
  {
    group: '창',
    items: [
      { keys: `${MOD} + ↓`, what: '아래 셸 칸 열기', where: '창 전체' },
      { keys: `${MOD} + ↑`, what: '셸 칸 접고 본문으로', where: '창 전체' },
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
