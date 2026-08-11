import { useEffect, useMemo, useState } from 'react'
import { fuzzyMatch } from '../state/fuzzy'

// `@` 자동완성.
//
// 목록은 **처음 한 번만** 받는다 — 글자마다 훑으면 큰 저장소에서 멈춘다
// (빠른 열기와 같은 판단).

const MAX_SHOWN = 8
/** 친 문자열이 경로에 그대로 들어 있을 때의 가산점 — 퍼지 점수 차이를 덮을 만큼 크게 */
const PATH_HIT_BONUS = 1000

export interface MentionPopupProps {
  /** `@` 뒤에 지금까지 친 것 */
  query: string
  onPick: (path: string) => void
  onClose: () => void
  /** 접근성 라벨. `/open` 이 재사용할 때는 용도(파일 열기)가 다르다. */
  label?: string
  /**
   * 폴더도 고를 수 있게 한다 (`@` 참조 전용 — `/open` 은 파일만 연다).
   * 폴더는 뒤에 `/` 를 붙여 넣는다: 파일과 구분되고, 받는 쪽도 그것으로 가른다.
   */
  includeDirs?: boolean
}

export function MentionPopup({ query, onPick, onClose, label, includeDirs }: MentionPopupProps) {
  const [files, setFiles] = useState<string[]>([])
  const [cursor, setCursor] = useState(0)

  useEffect(() => {
    void window.davis.listFiles().then((result) =>
      // 폴더를 먼저 — "@src/" 처럼 범위를 가리키려는 의도가 파일 하나보다 앞선다
      setFiles(includeDirs ? [...result.dirs.map((dir) => `${dir}/`), ...result.files] : result.files),
    )
  }, [includeDirs])

  const hits = useMemo(() => {
    if (query === '') return files.slice(0, MAX_SHOWN)
    const needle = query.toLowerCase()
    // `@dist/` 처럼 슬래시로 끝나면 그 폴더를 **열어 본다** — 바로 아래 한 단계만 나열한다.
    // (퍼지로 두면 dist-electron/… 같은 남의 경로가 올라와 폴더를 파고들 수가 없다)
    if (needle.endsWith('/')) return childrenOf(files, needle)
    return files
      .map((file) => ({ file, match: fuzzyMatch(query, file) }))
      .filter((entry) => entry.match !== null)
      .map((entry) => ({
        file: entry.file,
        // 친 그대로가 경로에 들어 있으면 압도적으로 앞에 둔다 — `@dist/asse` 는 dist/assets 를
        // 찾는 것이지, d-i-s-t-a-s-s-e 가 흩어져 있는 깊은 파일을 찾는 게 아니다.
        // 퍼지 점수만으로 세우면 basename 가산점 때문에 그런 파일들이 이긴다.
        score: entry.match!.score + (entry.file.toLowerCase().includes(needle) ? PATH_HIT_BONUS : 0),
      }))
      // 폴더가 항상 위 (사용자 지시) — 범위를 좁혀 가는 길이 먼저 보여야 한다
      .sort((a, b) => rank(a.file) - rank(b.file) || b.score - a.score)
      .slice(0, MAX_SHOWN)
      .map((entry) => entry.file)
  }, [files, query])

  // 목록이 바뀌면 커서를 맨 위로 — 안 그러면 엉뚱한 파일이 들어간다
  useEffect(() => setCursor(0), [query])

  // 키 조작은 입력창이 갖고 있으므로 창 수준에서 가로챈다
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setCursor((value) => Math.min(value + 1, hits.length - 1))
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setCursor((value) => Math.max(value - 1, 0))
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const picked = hits[cursor]
        if (picked) {
          event.preventDefault()
          onPick(picked)
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
  }, [hits, cursor, onPick, onClose])

  // 일치가 0행이어도 **상자를 DOM 에 남긴다** (보이지는 않는다). SlashPopup 과 같은 처방이다.
  //
  // 사라지면 Esc 의 임자 판정(`useShortcuts.ts` 의 `[role=listbox]`)이 팝업을 못 본다.
  // 그러면 `@zzzz` 처럼 일치 없는 참조를 치고 Esc 를 누를 때 위 캡처 리스너(:81)로 팝업은
  // 닫히면서 **같은 Esc 가 응답 중단까지 발동한다** — 오타를 지우려던 손동작이 진행 중인
  // 턴을 죽인다.
  //
  // 여기는 SlashPopup 과 달리 `choosing` 판정이 필요 없다 — 이 컴포넌트는 고르는 중일 때만
  // 마운트된다 (`Composer.tsx:259,264` 의 `mention !== null` / `openArg !== null`).
  if (hits.length === 0) {
    return <div className="dc-mentions" role="listbox" aria-label={label ?? '파일 참조'} hidden />
  }

  return (
    <div className="dc-mentions" role="listbox" aria-label={label ?? '파일 참조'}>
      {hits.map((file, index) => (
        <button
          key={file}
          type="button"
          role="option"
          aria-selected={index === cursor}
          className={`dc-mentions__item${index === cursor ? ' dc-mentions__item--on' : ''}`}
          onMouseEnter={() => setCursor(index)}
          onMouseDown={(event) => {
            // mousedown 이다 — click 이면 입력창이 포커스를 잃고 팝업이 먼저 닫힌다
            event.preventDefault()
            onPick(file)
          }}
        >
          <span className="dc-mentions__name">{baseName(file)}</span>
          <span className="dc-mentions__path">{file}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * 폴더 바로 아래 한 단계 — 하위 폴더 먼저, 그 다음 파일 (이름순).
 * 더 깊은 것(`dist/assets/x/y.js`)은 그 폴더를 다시 골라 들어간다.
 */
function childrenOf(files: string[], prefix: string): string[] {
  return files
    .filter((file) => {
      const lower = file.toLowerCase()
      if (!lower.startsWith(prefix) || lower === prefix) return false
      const rest = lower.slice(prefix.length)
      const slash = rest.indexOf('/')
      return slash === -1 || slash === rest.length - 1
    })
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .slice(0, MAX_SHOWN)
}

/** 폴더(뒤에 `/`)가 먼저, 그 다음 파일 */
function rank(path: string): number {
  return path.endsWith('/') ? 0 : 1
}

/** 폴더는 이름 뒤의 `/` 를 살려 파일과 한눈에 구분되게 한다 */
function baseName(path: string): string {
  const isDir = path.endsWith('/')
  const name = (isDir ? path.slice(0, -1) : path).split('/').pop() ?? path
  return isDir ? `${name}/` : name
}
