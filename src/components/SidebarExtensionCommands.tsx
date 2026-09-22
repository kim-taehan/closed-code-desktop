import type { ExtensionCommand } from '../../shared/extensions/manifest'
import { t } from '../i18n/messages'

// 사이드바 헤더 오른쪽의 확장 준비 행동(목록 갱신 등) 버튼들.
//
// `ProjectSidebar.tsx` 에서 그대로 옮겨 왔다 — 저쪽이 300줄 상한에 닿았고, 사이드바 웹뷰(하이닉스 H2)가
// 들어갈 자리가 필요했다. 동작·모양은 바꾸지 않았다.

export interface SidebarExtensionCommandsProps {
  /** 고른 확장 패널의 `placement: 'header'` 명령 (`commandSlots(...).header`) */
  commands: ExtensionCommand[]
  /** 지금 도는 명령 id 들 (`useExtensionPanel.running`) */
  running: string[]
  onRun: (commandId: string) => void
}

export function SidebarExtensionCommands({ commands, running: runningIds, onRun }: SidebarExtensionCommandsProps) {
  return (
    <>
      {commands.map((command) => {
        const running = runningIds.includes(command.id)
        // **글리프만 그리는 갈래**는 확장이 `icon` 을 적었을 때만이다. 안 적은 확장은
        // 예전 그대로 `↻` + 글자로 남는다 — 이미 쓰이던 자리를 말없이 바꾸지 않는다.
        const iconOnly = command.icon !== undefined
        return (
          <button
            key={command.id}
            type="button"
            className={`dc-sidebar__extcmd${iconOnly ? ' dc-sidebar__extcmd--icon' : ''}`}
            disabled={running}
            // 글자가 없으면 **무엇을 누르는지 말할 것이 여기뿐이다.** 툴팁과 낭독기 이름
            // 둘 다 준다 — 마우스가 없는 사람에게 툴팁은 없는 것과 같다.
            title={command.title}
            aria-label={iconOnly ? command.title : undefined}
            // 준비 행동에는 고른 것을 싣지 않는다 — 목록을 다시 만드는 일이라 대상이 없다
            onClick={() => onRun(command.id)}
          >
            {/* 도는 동안 글자가 「실행 중…」으로 바뀌는 것이 예전에는 유일한 신호였다.
                글리프만 남는 갈래에는 그 자리가 없으므로 도는 표시를 그림으로 바꿔 준다 —
                안 그러면 눌렀는지 안 눌렀는지 화면이 말하지 않는다. */}
            {running && iconOnly ? (
              <span className="ext-progress__spin" aria-hidden="true" />
            ) : (
              <span aria-hidden="true">{command.icon ?? '↻'}</span>
            )}
            {iconOnly ? null : running ? t('실행 중…') : command.title}
          </button>
        )
      })}
    </>
  )
}
