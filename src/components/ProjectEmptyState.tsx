import { useMemo, useState } from 'react'
import type { ProjectRecord } from '../../shared/projects/projectRecord'
import { fuzzyMatch } from '../state/fuzzy'

// 런처 — 첫 실행 화면이자 "+" 로 프로젝트를 더할 때 거치는 화면.
//
// **자동으로 폴더 선택 대화상자를 띄우지 않는다** (설계 §7).
// 켜자마자 뜨는 모달은 취소가 애매하고, 무엇보다 이미 아는 프로젝트를
// 다시 열려는 경우에 폴더를 처음부터 찾아가게 만든다.
//
// **2단 골격.** 왼쪽은 "여기가 무슨 화면인가"(이름·주 버튼), 오른쪽은 목록 전부.
// 가운데로 한 줄 쌓았을 때는 최근 목록이 460px 안에 갇혀 있었는데, 최근은
// RECENT_CAP(15) 까지 쌓이고 화면 위아래는 비어 있었다.

export interface ProjectEmptyStateProps {
  recent: ProjectRecord[]
  onPick: () => void
  onOpen: (root: string) => void
  /** 이미 연 프로젝트가 있을 때만 준다 — 돌아갈 곳이 있다는 뜻이다 */
  onCancel?: () => void
}

/** 이 개수부터 거르는 줄을 낸다. 두세 개뿐인데 검색칸이 있으면 허세다. */
const FILTER_FROM = 5

export function ProjectEmptyState(props: ProjectEmptyStateProps) {
  const [query, setQuery] = useState('')
  const shown = useMemo(() => matching(props.recent, query), [props.recent, query])

  // 즐겨찾기와 최근은 정렬 순서만 다를 뿐 같은 줄로 보였다. 묶음을 눈에 보이게 나눈다.
  const favorites = shown.filter((project) => project.favorite)
  const rest = shown.filter((project) => !project.favorite)

  return (
    <div className={`dc-launch${props.onCancel ? ' dc-launch--overlay' : ''}`}>
      <section className="dc-launch__intro">
        <p className="dc-launch__mark">
          <span className="dc-launch__glyph" aria-hidden="true">
            AX
          </span>
          AXGentic Code
        </p>
        <h1 className="dc-launch__title">어느 폴더에서 일할까요?</h1>

        <button type="button" className="dc-launch__open" onClick={props.onPick}>
          폴더 열기
        </button>

        {props.onCancel && (
          <button type="button" className="dc-launch__back" onClick={props.onCancel}>
            지금 화면으로 돌아가기
          </button>
        )}
      </section>

      <section className="dc-launch__pick">
        {props.recent.length === 0 ? (
          <p className="dc-launch__none">아직 연 프로젝트가 없습니다. 폴더를 열면 여기에 쌓입니다.</p>
        ) : (
          <>
            {props.recent.length >= FILTER_FROM && (
              <input
                type="search"
                className="dc-launch__filter"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="이름이나 경로로 거르기"
                aria-label="최근 프로젝트 거르기"
              />
            )}

            {shown.length === 0 && <p className="dc-launch__none">거른 결과가 없습니다.</p>}

            <ProjectGroup label="즐겨찾기" items={favorites} onOpen={props.onOpen} />
            <ProjectGroup label="최근" items={rest} onOpen={props.onOpen} />
          </>
        )}
      </section>
    </div>
  )
}

function ProjectGroup(props: {
  label: string
  items: ProjectRecord[]
  onOpen: (root: string) => void
}) {
  if (props.items.length === 0) return null

  return (
    <>
      <h2 className="dc-launch__group">{props.label}</h2>
      <ul className="dc-launch__list">
        {props.items.map((project) => (
          <li key={project.id}>
            <button type="button" onClick={() => props.onOpen(project.root)} title={project.root}>
              <span className="dc-launch__name">{project.name}</span>
              <span className="dc-launch__path">{whereLabel(project)}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

/**
 * 이름·경로 어느 쪽으로 쳐도 걸린다.
 *
 * **순서는 건드리지 않는다.** 점수순으로 다시 세우면 즐겨찾기·최근 묶음이 흔들려
 * 같은 프로젝트가 칠 때마다 다른 자리에 선다.
 */
function matching(projects: ProjectRecord[], query: string): ProjectRecord[] {
  const trimmed = query.trim()
  if (trimmed === '') return projects
  return projects.filter(
    (project) => fuzzyMatch(trimmed, project.name) !== null || fuzzyMatch(trimmed, project.root) !== null,
  )
}

/**
 * 경로는 "어느 폴더인가"에만 답하면 된다.
 *
 * 폴더명이 곧 표시 이름이면 마지막 칸을 떼어 같은 말을 두 번 읽히지 않게 한다.
 * 이름을 바꾼 프로젝트는 뗄 수 없다 — 떼면 어느 폴더인지 알 길이 사라진다.
 * (전체 경로는 title 로 늘 붙어 있다.)
 */
function whereLabel(project: ProjectRecord): string {
  const root = project.root.replace(/\/+$/, '')
  const cut = root.lastIndexOf('/')
  if (cut <= 0) return root
  return root.slice(cut + 1) === project.name ? root.slice(0, cut) : root
}
