import { useRef, useState } from 'react'
import { t } from '../i18n/messages'
import type { ExtensionCommand } from '../../shared/extensions/manifest'
import type { ExtensionProgressPayload } from '../../shared/ipc/channels'
import { useDismissOnOutside } from './SidebarPanelSelect'
import { ExtensionRunPane } from './ExtensionRunPane'
import type { ExtensionProgressLine } from '../state/extensionProgressLog'

// 확장 패널 **아래에 고정된 행동 바** (기획서 §3·§4).
//
// **늘 자리를 지킨다.** 고른 것이 있을 때만 나타나면 그때마다 트리 높이가 바뀌어
// 스크롤이 튄다 — 고른 것이 없으면 흐린 채로 둔다.
//
// 여기 사는 것은 **주 행동 하나**와 `⋯` 뿐이다. 준비 행동(목록 갱신)은 헤더로, 마무리는
// `⋯` 안으로 갔다 — 셋을 같은 크기로 늘어놓으면 무엇을 먼저 눌러야 하는지 화면이
// 말해 주지 않는다.

export interface ExtensionActionBarProps {
  /** 큰 버튼. 없으면 「할 수 있는 것이 없다」로 흐리게 둔다 */
  primary: ExtensionCommand | null
  /** `⋯` 안에 들어갈 것들. 비면 `⋯` 를 그리지 않는다 */
  menu: ExtensionCommand[]
  /** 고른 것을 탭별로 적은 한 줄. 빈 문자열이면 "고른 것이 없습니다" */
  pickedText: string
  /** 도는 중인 명령 id 들 */
  running: string[]
  /** 진행 상황. 있으면 고른 것 대신 이걸 말한다 — 지금 중요한 것은 그쪽이다 */
  progress: ExtensionProgressPayload | null
  /**
   * 쌓인 진행 줄. **끝난 뒤에도 남는다** — 자리를 비웠다 돌아온 사람에게 무엇이 됐고
   * 무엇이 실패했는지 말해 주는 것이 이것뿐이다 (`extensionProgressLog`).
   */
  lines: ExtensionProgressLine[]
  onRun: (commandId: string) => void
  /** 도는 질의를 끊는다. 주 버튼이 「중단」으로 바뀐다 */
  onCancel: () => void
  /**
   * 마지막 결과 화면을 본문 탭에 **다시** 띄운다. 보여 줄 결과가 없으면 `null`.
   *
   * 결과는 만들어지는 즉시 오른쪽에 뜨는데, 그것을 닫으면 **되열 길이 없었다** —
   * 띄우는 효과가 「HTML 이 바뀔 때」만 돌기 때문이다 (`ExtensionViewPanel`).
   * 명령이 아니라 앱이 쥔 화면이라 `⋯` 가 아니라 여기 둔다: 확장을 다시 돌리지 않는다.
   */
  onShowResult: (() => void) | null
}

export function ExtensionActionBar(props: ExtensionActionBarProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useDismissOnOutside(ref, () => setOpen(false), open)

  // **무엇이 돌든** 중단할 수 있어야 한다 — 주 행동만 보면 `⋯` 로 건 것은 못 멈춘다
  const running = props.running.length > 0

  return (
    <div className="ext-bar">
      {/* 도는 동안에는 **무엇을 몇 개에 대해** 하고 있는지가 고른 개수보다 중요하다.
          그래서 바의 무게가 두 모드로 갈린다: 고를 때는 한 줄, 돌 때는 진행 칸이 주인공이다.
          쌓인 줄이 남아 있으면 끝난 뒤에도 그대로 둔다 — 지우면 돌아온 사람에게는
          처음부터 아무 일도 없던 것과 같다. */}
      {props.progress === null && props.lines.length === 0 ? (
        <p className="ext-bar__picked">{props.pickedText === '' ? t('고른 것이 없습니다') : props.pickedText}</p>
      ) : (
        <ExtensionRunPane progress={props.progress} lines={props.lines} />
      )}

      <div className="ext-bar__row">
        {/* **도는 동안에는 같은 자리가 「중단」이 된다.** 잠긴 버튼으로 두면 수 분짜리
            작업에서 사용자가 할 수 있는 일이 없다 — 잘못 고른 대상을 훑기 시작해도 마찬가지다. */}
        {running ? (
          <button type="button" className="ext-bar__go ext-bar__go--stop" onClick={props.onCancel}>
            {t('중단')}
          </button>
        ) : (
          <button
            type="button"
            className={`ext-bar__go${props.primary === null ? ' ext-bar__go--off' : ''}`}
            // 주 행동이 없는 확장도 있다 (전부 header·menu 로 선언). 버튼을 지우지 않고
            // 흐린 채 두는 이유는 바의 높이를 지키기 위해서다.
            disabled={props.primary === null}
            onClick={() => props.primary && props.onRun(props.primary.id)}
          >
            {props.primary === null ? t('실행할 명령이 없습니다') : props.primary.title}
          </button>
        )}

        {/* **주 행동과 크기를 달리 한다.** 결과 보기는 준비도 마무리도 아닌 「되돌아보기」라,
            큰 버튼으로 두면 무엇을 눌러야 하는지가 다시 흐려진다. 도는 중에도 살려 둔다 —
            앞 판의 결과를 보며 기다리는 것이 이 확장의 보통 쓰임이다. */}
        {props.onShowResult !== null && (
          <button type="button" className="ext-bar__res" onClick={props.onShowResult}>
            {t('결과')}
          </button>
        )}

        {props.menu.length > 0 && (
          <div className="ext-bar__more" ref={ref}>
            <button
              type="button"
              className={`ext-bar__dots${open ? ' ext-bar__dots--on' : ''}`}
              aria-haspopup="menu"
              aria-expanded={open}
              aria-label={t('더 보기')}
              onClick={() => setOpen((previous) => !previous)}
            >
              ⋯
            </button>

            {open && (
              <div className="ext-bar__menu" role="menu">
                {props.menu.map((command) => (
                  <button
                    key={command.id}
                    type="button"
                    role="menuitem"
                    className="ext-bar__item"
                    disabled={props.running.includes(command.id)}
                    onClick={() => {
                      props.onRun(command.id)
                      setOpen(false)
                    }}
                  >
                    {command.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
