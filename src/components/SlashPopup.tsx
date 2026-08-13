import { useEffect, useMemo, useRef, useState } from 'react'
import { allSlashCommands, type SlashChoice, type SlashCommand } from '../state/slashCommands'
import { filterItems } from '../state/slashFilter'
import { useOpencodeCommands } from '../state/useOpencodeCommands'
import type { CommandSummaryPayload } from '../../shared/ipc/channels'

// `/` 자동완성 — **한 단계 평면 목록** (opencode CLI 와 같은 모양).
//
// 예전에는 davis 식으로 `카테고리 → 항목` 2단계였다(`/command clear`·`/skill pptx`).
// opencode 는 명령·MCP 프롬프트·스킬을 **한 목록**으로 주고 CLI 도 그대로 한 번에 보여
// 준다. 종류는 줄 옆 태그로만 갈린다.
//
//   `/`      → 데스크톱 명령 + opencode 가 아는 것 전부
//   `/re`    → 이름·설명 어디든 걸리면 남는다
//   `/re `   → 공백부터는 인자 구간이다. 팝업은 Composer 가 닫는다 (skillAtCaret)
//
// 목록은 `useOpencodeCommands` 가 가져온다 — `+ → 스킬` 과 **같은 출처**여야 한다.

// 상자는 CSS 로 이미 스크롤된다(`.dc-mentions` max-height 260px). 이 숫자는 그 위에 얹은
// 뚜껑이라, 2단계 시절(카테고리마다 8줄)의 8을 그대로 두면 **데스크톱 명령 6개가 자리를
// 먹고 opencode 스킬은 거의 안 보인다** (실서버 기준 항목이 스물 넘는다). 넉넉히 열어 두고
// 좁히는 것은 쿼리에 맡긴다.
const MAX_SHOWN = 24

type Row =
  | { kind: 'command'; command: SlashCommand }
  | { kind: 'opencode'; item: CommandSummaryPayload }

export interface SlashPopupProps {
  /** `/` 를 뗀 지금 치고 있는 이름. `''` · `'re'` */
  query: string
  onPick: (choice: SlashChoice) => void
  onClose: () => void
}

export function SlashPopup({ query, onPick, onClose }: SlashPopupProps) {
  const { commands } = useOpencodeCommands()
  const [cursor, setCursor] = useState(0)
  const cursorRef = useRef<HTMLButtonElement>(null)

  const rows = useMemo<Row[]>(() => {
    // 데스크톱 명령이 앞이다 — 서버가 모르는 동작이라 이름이 겹쳐도 이쪽이 임자다
    // (resolveSlashSubmission 의 찾는 순서와 같아야 한다).
    const entries = [
      ...allSlashCommands().map((command) => ({
        display: command.name,
        description: command.description,
        row: { kind: 'command' as const, command },
      })),
      ...commands.map((item) => ({
        display: item.name,
        description: item.description,
        row: { kind: 'opencode' as const, item },
      })),
    ]
    return filterItems(entries, query)
      .map((entry) => entry.row)
      .slice(0, MAX_SHOWN)
  }, [commands, query])

  useEffect(() => setCursor(0), [query])

  // 목록이 상자보다 길다 — 화살표로 내려간 항목이 화면 밖에 있으면 **고르는 중인 것이
  // 안 보인다.** jsdom 에는 scrollIntoView 가 없어 옵셔널로 부른다 (테스트가 죽지 않게).
  useEffect(() => cursorRef.current?.scrollIntoView?.({ block: 'nearest' }), [cursor])

  const pick = (row: Row) => {
    if (row.kind === 'command') {
      onPick({ kind: 'command', command: row.command })
      return
    }
    onPick({ kind: 'opencode', name: row.item.name })
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

  if (rows.length === 0) {
    // 일치가 0행이어도 **상자를 DOM 에 남긴다** (보이지는 않는다).
    //
    // 사라지면 Esc 의 임자 판정(`useShortcuts.ts` 의 `[role=listbox]`)이 팝업을 못 본다.
    // 그러면 `/zzzz` 처럼 일치 없는 슬래시를 치고 Esc 를 누를 때 위 캡처 리스너로 팝업은
    // 닫히면서 **같은 Esc 가 응답 중단까지 발동한다** — 오타를 지우려던 손동작이 진행 중인
    // 턴을 죽인다. `/` 뒤에 오타를 내고 Esc 로 지우는 것은 흔한 손동작이라 트리거가 좁지 않다.
    return <div className="dc-mentions" role="listbox" aria-label="명령·스킬" hidden />
  }

  return (
    <div className="dc-mentions" role="listbox" aria-label="명령·스킬">
      {rows.map((row, index) => {
        const name = row.kind === 'command' ? row.command.name : row.item.name
        return (
          <button
            key={`${row.kind}:${name}`}
            ref={index === cursor ? cursorRef : undefined}
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
              {row.kind === 'opencode' && <Tags item={row.item} />}
            </span>
            <span className="dc-mentions__path">
              {row.kind === 'command' ? row.command.description : row.item.description}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * opencode 가 항목에 달아 준 것들. **명령은 태그가 없다** — 데스크톱 명령과 같은 줄로
 * 보이는 것이 opencode CLI 의 모양이고, 사용자에게도 그 둘의 구분은 필요 없다.
 *
 * `subtask`·`agent`·`model` 은 **보여만 준다** — 지금은 그대로 따라가지 않는다
 * (`opencodeCommand.ts` 의 "못 따라가는 것").
 */
function Tags({ item }: { item: CommandSummaryPayload }) {
  return (
    <>
      {item.source === 'skill' && <span className="dc-skill__tag">스킬</span>}
      {item.source === 'mcp' && <span className="dc-skill__tag">MCP</span>}
      {item.subtask && <span className="dc-skill__tag">subtask</span>}
      {item.agent && <span className="dc-skill__tag">@{item.agent}</span>}
      {item.model && <span className="dc-skill__tag">{item.model}</span>}
    </>
  )
}
