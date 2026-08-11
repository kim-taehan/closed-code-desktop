import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectRecord } from '../../shared/projects/projectRecord'
import { STATUS_LABEL, type ProjectStatus } from '../state/projectStatus'
import { projectBadges } from '../state/projectBadge'
import { AppMenu, type AppMenuProps } from './AppMenu'
import { t } from '../i18n/messages'

// 맨 위 가로 레일. 왼쪽은 프로젝트 **전환**(설계 §7), 오른쪽 끝은 파일 검색과 설정.
//
// 칩 생김새는 IntelliJ 의 프로젝트 위젯을 따랐다 — **색 배지에 흰 머리글자 + 이름**.
// 예전 탭은 글자와 점뿐이라 프로젝트를 가르는 것이 이름 글자밖에 없었는데,
// `davis-backend-tobe` · `davis-code-desktop` 처럼 앞이 겹치면 그마저 안 갈렸다.
// 색과 머리글자가 먼저 눈에 들어오고 이름이 그것을 확인해 준다.
//
// **이름 고치기(더블클릭)와 닫기(×)도 여기 있다.** "이름이 보이는 자리가 고치는 자리" 라는
// 규칙 그대로다 — 이름이 아래 탭줄에도 있던 시절엔 그쪽이었지만, 중복이라 걷어냈다.
// 더블클릭이 먼저 전환을 일으키는 것은 문제가 아니다: 고치려는 프로젝트로 옮겨 가는 것이다.
//
// 파일 검색·설정이 이 줄 오른쪽 끝에 있는 이유: 둘 다 **앱 전역**이라 프로젝트·파일보다
// 위층이다. 예전에는 ⚙ 가 본문 위에 절대위치로 떠 파일 도구바와 나란히 보였고,
// 그러면 파일 도구처럼 읽힌다.

export interface ProjectRailProps {
  open: ProjectRecord[]
  activeId: string | null
  /** 프로젝트별 상태. 비활성 칩도 여기로 진행 상황을 알린다 (설계 §5). */
  statusOf: (id: string) => ProjectStatus
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onRename: (id: string, name: string) => void
  onPick: () => void
  /** 파일 이름으로 빠르게 열기 */
  onSearchFiles: () => void
  /** ⚙ 메뉴가 여는 것들. 메뉴 자체는 이 줄이 그린다 */
  menu: AppMenuProps
}

export function ProjectRail(props: ProjectRailProps) {
  // 색은 **열려 있는 것들을 한꺼번에 보고** 정한다 — 따로 정하면 나란히 있는 둘이
  // 같은 색이 될 수 있다 (실측: `davis-backend-tobe` 44도 · `docs` 42도)
  const badges = useMemo(
    () => projectBadges(props.open.map((project) => project.name)),
    [props.open],
  )

  return (
    <div className="project-rail">
      <div className="project-rail__projects" role="tablist" aria-label={t('프로젝트')}>
        {props.open.map((project) => {
          const active = project.id === props.activeId
          const status = props.statusOf(project.id)
          const badge = badges.get(project.name)

          return (
            <span
              key={project.id}
              className={`project-chip${active ? ' project-chip--active' : ''}`}
              // 이름만으로는 어느 폴더인지 모른다 — 같은 이름을 다른 곳에서 열 수 있다
              title={`${project.name}\n${project.root}`}
            >
              <span
                className="project-chip__badge"
                style={badge ? { background: badge.color } : undefined}
                aria-hidden="true"
              >
                {badge?.initials ?? '?'}
              </span>
              <span
                className={`project-chip__dot project-chip__dot--${status}`}
                title={STATUS_LABEL[status]}
                aria-label={STATUS_LABEL[status]}
              />
              <ChipLabel
                project={project}
                active={active}
                onActivate={() => props.onActivate(project.id)}
                onRename={(name) => props.onRename(project.id, name)}
              />
              <button
                type="button"
                className="project-chip__close"
                title={t('프로젝트 닫기')}
                aria-label={`${t('닫기')} ${project.name}`}
                onClick={() => props.onClose(project.id)}
              >
                ×
              </button>
            </span>
          )
        })}

        <button
          type="button"
          className="project-chip project-chip--add"
          title={t('프로젝트 열기…')}
          aria-label={t('프로젝트 열기')}
          onClick={props.onPick}
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>

      <div className="project-rail__tools">
        <button
          type="button"
          className="rail-tool"
          title={t('파일 검색')}
          aria-label={t('파일 검색')}
          onClick={props.onSearchFiles}
        >
          <SearchIcon />
        </button>
        <AppMenu {...props.menu} />
      </div>
    </div>
  )
}

/** 칩의 이름 부분. 누르면 전환, 두 번 누르면 제자리에서 고친다. */
function ChipLabel({
  project,
  active,
  onActivate,
  onRename,
}: {
  project: ProjectRecord
  active: boolean
  onActivate: () => void
  onRename: (name: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(project.name)
  const inputRef = useRef<HTMLInputElement>(null)

  // 다른 칩으로 옮기거나 이름이 바뀌면 편집을 접는다 — 남기면 남의 이름을 고치게 된다
  useEffect(() => {
    setDraft(project.name)
    setEditing(false)
  }, [project.id, project.name])

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  function commit(): void {
    setEditing(false)
    const trimmed = draft.trim()
    // 빈 이름은 무시하고 되돌린다 (레지스트리도 같은 판단을 한다)
    if (trimmed === '' || trimmed === project.name) {
      setDraft(project.name)
      return
    }
    onRename(trimmed)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="project-chip__edit"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape') {
            setDraft(project.name)
            setEditing(false)
          }
        }}
        aria-label={t('프로젝트 이름')}
      />
    )
  }

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className="project-chip__name"
      onClick={onActivate}
      onDoubleClick={() => setEditing(true)}
    >
      {project.name}
    </button>
  )
}

/** 글리프(🔍)는 OS 마다 모양·크기가 달라 줄이 흔들린다. 획 굵기를 우리가 정한다. */
function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" width="22" height="22" aria-hidden="true" focusable="false">
      <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M13.2 13.2 L17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
