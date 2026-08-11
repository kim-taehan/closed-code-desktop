import { useEffect, useMemo, useState } from 'react'
import { allSlashCommands, type SlashChoice, type SlashCommand } from '../state/slashCommands'
import {
  filterCategories,
  filterItems,
  parseSlashInput,
  type SlashCategory,
} from '../state/slashNamespace'
import type { SkillSummaryPayload } from '../../shared/ipc/channels'

// `/` 자동완성 — **카테고리 → 항목 2단계** (DC-980).
//
// 예전에는 명령과 스킬이 한 목록에 섞여 쏟아졌다. 항목이 늘수록 못 찾는다.
//
//   `/`               → 카테고리 (커맨드 · 스킬)
//   `/command `       → 그 카테고리의 항목만
//   `/command clear ` → 항목까지 정해짐 → 팝업을 닫고 사용자가 인자를 친다
//
// 단계 판별·필터는 slashNamespace 가 순수 함수로 한다. 여기는 그리기와 키 처리만.
// 스킬 목록은 `+ → 스킬` 과 같은 것을 쓴다 — 두 곳이 다른 목록을 보이면 안 된다.

const MAX_SHOWN = 8

type Row =
  | { kind: 'category'; category: SlashCategory }
  | { kind: 'command'; command: SlashCommand }
  | { kind: 'skill'; skill: SkillSummaryPayload }

export interface SlashPopupProps {
  /** `/` 를 뗀 지금 맥락. `''` · `'com'` · `'command cl'` */
  query: string
  onPick: (choice: SlashChoice) => void
  onClose: () => void
}

export function SlashPopup({ query, onPick, onClose }: SlashPopupProps) {
  const [skills, setSkills] = useState<SkillSummaryPayload[]>([])
  const [cursor, setCursor] = useState(0)

  useEffect(() => {
    void window.davis.listSkills().then((result) => setSkills(result.skills))
  }, [])

  const parsed = useMemo(() => parseSlashInput(`/${query}`), [query])

  const rows = useMemo<Row[]>(() => {
    if (!parsed || parsed.kind === 'prompt') return []

    if (parsed.kind === 'category') {
      return filterCategories(parsed.query)
        .map((category) => ({ kind: 'category' as const, category }))
        .slice(0, MAX_SHOWN)
    }

    if (parsed.type === 'command') {
      return filterItems(
        allSlashCommands().map((command) => ({
          display: command.name,
          description: command.description,
          command,
        })),
        parsed.query,
      )
        .map((entry) => ({ kind: 'command' as const, command: entry.command }))
        .slice(0, MAX_SHOWN)
    }

    return filterItems(
      skills.map((skill) => ({ display: skill.name, description: skill.description, skill })),
      parsed.query,
    )
      .map((entry) => ({ kind: 'skill' as const, skill: entry.skill }))
      .slice(0, MAX_SHOWN)
  }, [parsed, skills])

  useEffect(() => setCursor(0), [query])

  const pick = (row: Row) => {
    if (row.kind === 'category') {
      onPick({ kind: 'category', namespace: row.category.namespace })
      return
    }
    if (row.kind === 'command') {
      onPick({ kind: 'command', command: row.command })
      return
    }
    onPick({ kind: 'skill', name: row.skill.name })
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setCursor((value) => Math.min(value + 1, rows.length - 1))
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setCursor((value) => Math.max(value - 1, 0))
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const picked = rows[cursor]
        if (picked) {
          event.preventDefault()
          pick(picked)
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }

    // capture 로 받는다 — 입력창의 Enter(전송)보다 먼저 잡아야 한다
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [rows, cursor, onPick, onClose])

  // 고르는 중인가. 프롬프트 단계(항목까지 정해져 인자를 치는 중)와 슬래시 맥락이 아닌 것은
  // 팝업이 **진짜로 닫힌** 상태다 — rows 가 비는 사유가 둘이라 여기서 가른다 (:47 참조).
  const choosing = parsed !== null && parsed.kind !== 'prompt'

  if (rows.length === 0) {
    if (!choosing) return null

    // 고르는 중인데 일치가 0행이면 **상자를 DOM 에 남긴다** (보이지는 않는다).
    //
    // 사라지면 Esc 의 임자 판정(`useShortcuts.ts` 의 `[role=listbox]`)이 팝업을 못 본다.
    // 그러면 `/zzzz` 처럼 일치 없는 슬래시를 치고 Esc 를 누를 때 위 캡처 리스너(:107)로
    // 팝업은 닫히면서 **같은 Esc 가 응답 중단까지 발동한다** — 오타를 지우려던 손동작이
    // 진행 중인 턴을 죽인다. `/` 뒤에 오타를 내고 Esc 로 지우는 것은 흔한 손동작이라
    // 트리거가 좁지 않다.
    //
    // 판정 기준은 "행이 있는가"가 아니라 "고르는 중인가"다.
    return <div className="dc-mentions" role="listbox" aria-label="명령·스킬" hidden />
  }

  // 지금 어느 단계인지 알려준다 — 2단계에서는 "무엇 안에서 고르는 중"인지가 안 보이면 헷갈린다
  const header = parsed?.kind === 'item' ? parsed.namespace : '카테고리'

  return (
    <div className="dc-mentions" role="listbox" aria-label="명령·스킬">
      <div className="dc-mentions__head">{header}</div>
      {rows.map((row, index) => {
        const name = labelOf(row)
        return (
          <button
            key={`${row.kind}:${name}`}
            type="button"
            role="option"
            aria-selected={index === cursor}
            className={`dc-mentions__item${index === cursor ? ' dc-mentions__item--on' : ''}`}
            onMouseEnter={() => setCursor(index)}
            onMouseDown={(event) => {
              // mousedown 이다 — click 이면 입력창이 포커스를 잃고 팝업이 먼저 닫힌다
              event.preventDefault()
              pick(row)
            }}
          >
            <span className="dc-skill__head">
              <span className="dc-mentions__name">{name}</span>
              {row.kind === 'category' && <span className="dc-skill__tag">카테고리</span>}
              {row.kind === 'skill' && row.skill.builtin && (
                <span className="dc-skill__tag dc-skill__tag--builtin">내장</span>
              )}
              {row.kind === 'skill' && row.skill.context === 'fork' && (
                <span className="dc-skill__tag">fork</span>
              )}
            </span>
            <span className="dc-mentions__path">{descriptionOf(row)}</span>
          </button>
        )
      })}
    </div>
  )
}

function labelOf(row: Row): string {
  if (row.kind === 'category') return row.category.namespace
  if (row.kind === 'command') return row.command.name
  return row.skill.name
}

function descriptionOf(row: Row): string {
  if (row.kind === 'category') return row.category.description
  if (row.kind === 'command') return row.command.description
  return row.skill.description
}
