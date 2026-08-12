import { QuickOpen } from './QuickOpen'
import { SearchPanel } from './SearchPanel'
import { SettingsDialog } from './SettingsDialog'
import { McpDialog } from './McpDialog'
import { ConnectionTest } from './ConnectionTest'
import { ExtensionAskText } from './ExtensionAskText'
import { useExtensionAskText } from '../state/useExtensionAskText'
import { useDoctorGate } from '../state/useDoctorGate'
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
  // 연결에 실패한 프로젝트를 열면 진단을 **스스로 띄운다** (프로젝트당 한 번).
  // 판정이 여기 있는 이유는 `status`·`project` 가 이미 여기 오기 때문이다 — App 은 안 고친다.
  const gate = useDoctorGate(props.project?.id, props.status)
  return (
    <>

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
            ? {
                // 진단이 못 고친 주소·키 문제는 이 팝업 안에서 바로 고친다 (왕복 제거)
                fix: {
                  project: props.project,
                  settings: props.appSettings.value,
                  onSaveSettings: props.appSettings.save,
                },
              }
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
