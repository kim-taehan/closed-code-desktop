import type { RefObject } from 'react'
import { LogView } from '../logs/LogView'
import { GestureTrail } from './GestureTrail'
import { OpenTab } from './OpenTab'
import { ChatPane } from './ChatPane'
import { ScmTab } from './ScmTab'
import type { GitPanelActions } from '../state/useGitActions'
import type { GitBulkActions } from '../state/useGitBulkActions'
import type { GitStateHandle } from '../state/useGitState'
import type { ToastApi } from '../state/useToasts'
import type { MouseGestureApi } from '../state/useMouseGesture'
import type { OpenFilesApi } from '../state/useOpenFiles'
import { SCM_TAB, type ScmViewHandle } from '../state/useScmView'
import type { SessionSlice } from '../state/sessionSlice'

// 본문 한 갈래를 그린다 — 로그 탭 / 소스 관리 탭 / 파일·diff 탭 / 대화. 동시에 하나만 렌더된다.
//
// 제스처 래핑도 여기 함께 있다. 세 갈래가 같은 인스턴스를 나눠 쓰므로(App 이 하나만 만든다)
// 래핑을 App 에 남기고 분기만 떼면 갈래마다 래퍼가 흩어진다.

export interface MainViewProps {
  /** 로그 탭이 열려 있는가 (파일이 아닌 탭의 여닫이는 App 이 boolean 으로 쥔다) */
  logs: boolean
  /** 소스 관리 탭이 열려 있는가. 로그와 같은 규칙 */
  scm: boolean
  /** 탭 안의 갈래·선택 (useScmView) — 탭을 떠나도 남게 App 이 쥔다 */
  scmView: ScmViewHandle
  git: GitStateHandle
  gitActions: GitPanelActions
  /** 묶음 행동 — 사이드바와 소스 관리 탭이 같은 것을 쓴다 */
  gitBulk: GitBulkActions
  /** 소스 관리 탭이 어느 저장소를 다루는지. 없으면 조회·행동을 아예 하지 않는다. */
  projectId: string | null
  toasts: ToastApi
  openFiles: OpenFilesApi
  gesture: MouseGestureApi
  slice: SessionSlice
  scrollRef: RefObject<HTMLDivElement | null>
}

export function MainView(props: MainViewProps) {
  const { logs, openFiles, gesture, slice, scrollRef } = props

  if (logs && openFiles.active === 'logs') {
    return (
      // display:contents — 레이아웃에 안 끼고 제스처 이벤트만 받는다
      <div style={{ display: 'contents' }} {...gesture.handlers}>
        <LogView />
        <GestureTrail gesture={gesture} />
      </div>
    )
  }

  if (props.scm && openFiles.active === SCM_TAB) {
    return (
      // 로그와 같은 래핑 — 탭이 본문 높이를 통째로 쓰고 스크롤은 안에서 쥔다
      <div style={{ display: 'contents' }} {...gesture.handlers}>
        <ScmTab
          state={props.git.state}
          loading={props.git.loading}
          onRefresh={props.git.refetch}
          onPull={props.gitActions.onPull}
          view={props.scmView}
          // 히스토리·브랜치 갈래는 조회가 전부라 프로젝트와 알림만 있으면 된다
          refs={{ projectId: props.projectId, toasts: props.toasts }}
          changes={{
            projectId: props.projectId,
            toasts: props.toasts,
            bulk: props.gitBulk,
            onToggle: (path, stage) => void props.git.toggle(path, stage),
            onRevert: props.gitActions.onRevert,
            onCommit: props.gitActions.onCommit,
            onPush: props.gitActions.onPush,
          }}
        />
        <GestureTrail gesture={gesture} />
      </div>
    )
  }

  if (openFiles.active !== 'chat') {
    return (
      <div className="app-scroll" {...gesture.handlers}>
        <GestureTrail gesture={gesture} />
        <OpenTab
          file={
            openFiles.files.find((file) => file.path === openFiles.active) ?? {
              path: openFiles.active,
              text: '',
            }
          }
          onEdit={openFiles.edit}
          onFlush={openFiles.flush}
          onSelection={openFiles.setSelection}
          onOpenPath={openFiles.open}
        />
      </div>
    )
  }

  return (
    <ChatPane
      slice={slice}
      gesture={gesture}
      scrollRef={scrollRef}
      chatContext={openFiles.chatContext}
      onOpenFile={openFiles.open}
    />
  )
}
