import { QuickOpen } from './QuickOpen'
import { SearchPanel } from './SearchPanel'
import { SettingsDialog } from './SettingsDialog'
import { McpDialog } from './McpDialog'
import { ConnectionTest } from './ConnectionTest'
import { ExtensionAskText } from './ExtensionAskText'
import { useExtensionAskText } from '../state/useExtensionAskText'
import { useDoctorGate } from '../state/useDoctorGate'
import { useAutoHeal } from '../state/useAutoHeal'
import { HealBanner } from './HealBanner'
import { RunHealBanner } from './RunHealBanner'
import type { ProjectRecord } from '../../shared/projects/projectRecord'
import type { McpState } from '../../shared/protocol/mcpConfig'
import type { ProjectStatus } from '../state/projectStatus'
import type { AppSettingsApi } from '../state/useAppSettings'
import type { ThemeState } from '../state/useTheme'

// 창 위에 뜨는 것들을 한곳에 모은다.
// App 이 300줄을 넘어 갈라냈다 — 대화 흐름과 팝업은 함께 자랄 이유가 없다.

export interface AppDialogsProps {
  palette: 'quickOpen' | 'search' | null
  onClosePalette: () => void
  onOpenFile: (path: string) => void

  settingsOpen: boolean
  testingOpen: boolean
  /** 없으면 설정·연결 테스트를 띄우지 않는다 (둘 다 프로젝트를 다룬다) */
  project?: ProjectRecord
  theme: ThemeState
  mcp: McpState
  /** 커넥터(MCP) 팝업 — +버튼에서 연다 */
  mcpOpen: boolean
  onCloseMcp: () => void
  appSettings: AppSettingsApi
  status?: ProjectStatus
  failure?: string
  onCloseSettings: () => void
  onCloseTesting: () => void
  /** 피드백 창. 다이얼로그는 전부 여기 모인다 — App 이 하나만 따로 들고 있었다 */
}

export function AppDialogs(props: AppDialogsProps) {
  // 확장이 사람에게 묻는 창. 스스로 구독하므로 부르는 쪽이 넘길 것이 없다.
  const askText = useExtensionAskText()
  // 세션이 깨지면 **스스로 사다리를 탄다** (설계 2026-08-16).
  // 배지를 눌러 연 팝업이 떠 있는 동안에는 시작하지 않는다 — 그 창도 같은 사다리를 몰기
  // 때문에 겹치면 조치가 두 번 나간다.
  // (게이트가 연 창은 **이미 돈 사다리를 그리기만** 하므로 겹칠 것이 없다.)
  const heal = useAutoHeal(props.project?.id, props.status, { enabled: !props.testingOpen })
  // 사다리가 **다 실패한** 프로젝트만 진단을 스스로 띄운다 (프로젝트당 한 번).
  // 판정이 여기 있는 이유는 `status`·`project` 가 이미 여기 오기 때문이다 — App 은 안 고친다.
  const gate = useDoctorGate(props.project?.id, heal.failed)
  return (
    <>
      {/* 상태줄·배너. 창이 뜨기 전 단계의 표시라 다이얼로그들과 같은 자리에 산다 */}
      <HealBanner notice={heal.notice} />

      {/* 실행이 로그에 아는 실패를 뱉으면 스스로 고친다 (설계 2026-08-16 §4).
          **여기 사는 이유는 수명이다** — 사이드바 「실행」 패널은 그 패널을 볼 때만
          마운트되는데, 오토힐링은 사용자가 어디를 보고 있든 돌아야 한다. 위 자가 복구와
          같은 자리인 것도 맞다: 둘 다 "앱이 스스로 뭔가 하고 있다" 를 알리는 띠다. */}
      {props.project && <RunHealBanner projectId={props.project.id} />}

      {props.palette === 'quickOpen' && (
        <QuickOpen onOpen={props.onOpenFile} onClose={props.onClosePalette} />
      )}
      {props.palette === 'search' && (
        <SearchPanel onOpen={props.onOpenFile} onClose={props.onClosePalette} />
      )}

      {props.settingsOpen && props.project && (
        <SettingsDialog
          theme={props.theme.choice}
          onTheme={props.theme.setChoice}
          settings={props.appSettings.value}
          onSaveSettings={props.appSettings.save}
          onClose={props.onCloseSettings}
        />
      )}


      {props.mcpOpen && props.project && <McpDialog state={props.mcp} onClose={props.onCloseMcp} />}

      {/* 확장의 물음. **프로젝트가 없어도 뜬다** — 확장 호스트는 앱 수명이라
          프로젝트를 안 연 상태에서도 명령이 돌 수 있고, 안 그리면 그 확장이 영영 걸린다. */}
      {askText.current && <ExtensionAskText request={askText.current} onRespond={askText.respond} />}

      {/* 배지를 눌러 연 것(`testingOpen`)과 자동 게이트가 연 것(`gate.open`)이 **같은 팝업**이다 —
          진단·수정이 한 표면이라 온보딩용을 따로 두지 않는다 (`ConnectionTest` 머리주석).
          `onHealthy` 는 진단이 초록으로 끝났을 때 스스로 닫으라는 뜻이다. */}
      {(props.testingOpen || gate.open) && props.status && (
        <ConnectionTest
          status={props.status}
          projectPath={props.project?.root ?? ''}
          {...(props.failure ? { failure: props.failure } : {})}
          onHealthy={gate.close}
          {...(props.project
            ? // 프로젝트가 있을 때만 연결 열을 연다 — 서버가 프로젝트마다 하나라
              // 열린 것이 없으면 보여 줄 주소도 다시 붙을 곳도 없다
              { fix: true }
            : {})}
          {...(gate.open && !props.testingOpen && heal.result
            ? // 게이트가 연 창은 **이미 돈 사다리를 그린다** — 여기서 또 돌면 서버 재시작이
              // 한 번 더 나가고 그것이 재시작 루프다 (설계 §2). 배지를 눌러 연 창
              // (`testingOpen`)은 사용자가 새로 재라는 뜻이라 주지 않는다.
              { initial: heal.result }
            : {})}
          onClose={() => {
            // 어느 쪽으로 열렸든 닫는 손짓은 하나다 — 둘 다 내려야 한 번에 닫힌다
            gate.close()
            props.onCloseTesting()
          }}
        />
      )}
    </>
  )
}
