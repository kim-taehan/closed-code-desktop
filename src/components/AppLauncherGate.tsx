import { ProjectEmptyState } from './ProjectEmptyState'
import type { ProjectsApi } from '../state/useProjects'

// App 본체를 그리기 전의 전체 화면 분기 — 첫 목록 대기·프로젝트 없음·런처.
// App 에서 응집 분리한 것으로 분기 순서·행동은 그대로다 (파일 크기 게이트).

export interface AppLauncherGateProps {
  projects: ProjectsApi
  /** 런처를 닫는다. 프로젝트 열기에 성공했을 때도 이 경로로 닫힌다. */
  onCancel: () => void
}

export function AppLauncherGate({ projects, onCancel }: AppLauncherGateProps) {
  const openAndClose = (run: () => Promise<boolean>) => {
    void run().then((ok) => {
      if (ok) onCancel()
    })
  }

  // 첫 목록이 오기 전에는 아무것도 그리지 않는다.
  // 열린 프로젝트가 있는데도 런처가 잠깐 번쩍이면 화면이 뒤집힌 것처럼 보인다.
  if (!projects.loaded) return <div className="dc-empty" />

  // 연 프로젝트가 없으면 대화 화면 대신 런처를 보인다. 이때는 돌아갈 곳이 없어 취소도 없다.
  if (projects.open.length === 0) {
    return (
      <ProjectEmptyState
        recent={projects.all}
        onPick={() => openAndClose(projects.pick)}
        onOpen={(root) => openAndClose(() => projects.openRoot(root))}
      />
    )
  }

  return (
    <ProjectEmptyState
      recent={projects.all}
      onPick={() => openAndClose(projects.pick)}
      onOpen={(root) => openAndClose(() => projects.openRoot(root))}
      onCancel={onCancel}
    />
  )
}
