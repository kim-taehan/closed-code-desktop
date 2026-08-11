import type { WorkingDirPayload } from '../../shared/ipc/channels'
import { t } from '../i18n/messages'

// 현재 세션 작업 경로 (ADR-036 / DC-1146).
//
// set_working_directory 로 작업 경로가 워크스페이스 밖으로 나가면, 이후 편집·명령이
// **다른 폴더에서** 일어난다. 그걸 모르면 "왜 내 파일이 안 바뀌지"가 된다.
// override 가 걸린 동안에만 입력창 위에 떠서 지금 어디서 도는지 알린다.
//
// override 가 없으면 아무것도 그리지 않는다 — 평상시 화면을 어지럽히지 않는다.

export interface WorkingDirBarProps {
  workingDir: WorkingDirPayload
}

export function WorkingDirBar({ workingDir }: WorkingDirBarProps) {
  if (!workingDir.active || !workingDir.path) return null

  const label = workingDir.projectName ?? basename(workingDir.path)

  return (
    <div
      className="workdir-bar"
      // 경로가 길면 잘리므로 전체 경로는 툴팁으로 남긴다
      title={`${t('현재 작업 경로')} — ${workingDir.path}`}
    >
      <span className="workdir-bar__icon" aria-hidden>
        📂
      </span>
      <span className="workdir-bar__label">{label}</span>
      <span className="workdir-bar__path">{workingDir.path}</span>
      {workingDir.kind === 'external' && (
        <span className="workdir-bar__tag">{t('워크스페이스 밖')}</span>
      )}
    </div>
  )
}

/** projectName 이 없을 때 쓸 이름 — 경로 마지막 조각이면 충분하다. */
function basename(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts.at(-1) ?? path
}
