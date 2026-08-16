import { useCallback, useEffect, useState } from 'react'
import { manifestFingerprint, MANIFEST_FILES } from '../../shared/run/runManifest'
import { parseRunSection, type RunEntry } from '../../shared/run/runSection'

// 실행 목록을 **AGENTS.md 에서 읽는다** (설계 §2). 앱이 캐시를 따로 들지 않는다 —
// 파일이 곧 캐시다. 그래서 여기 있는 것은 「지금 파일이 뭐라고 적혀 있나」뿐이고,
// 목록을 만들어 내는 일(모델 20초)은 이 훅이 하지 않는다.
//
// **읽는 것은 렌더러다.** main 에 새 문을 내지 않고 이미 있는 `readFile` 을 쓴다 —
// 프로젝트 안의 파일이고, 경로 판정(`resolveInside`)이 거기 한 벌 있다. 문을 새로 내면
// 그 판정이 두 벌이 된다.

export const AGENTS_FILE = 'AGENTS.md'

export interface RunListHandle {
  entries: RunEntry[]
  /**
   * 「실행」 절이 **있었나.** 절이 없는 것과 절이 비어 있는 것은 다른 사실이라 가른다 —
   * 앞은 아직 안 물어본 것이고, 뒤는 물어봤는데 못 찾은 것이다 (`runSourceLine`).
   */
  found: boolean
  /**
   * 매니페스트가 목록을 적을 때와 **다르다.** 화면이 "다시 확인할까요?" 를 띄운다.
   *
   * ⚠️ **말없이 다시 분석하지 않는다** (설계 §2) — 20초를 사용자 모르게 태우지 않는다.
   * 그래서 이 값은 화면에 물음을 띄울 뿐 아무것도 부르지 않는다.
   */
  stale: boolean
  loading: boolean
  /** ↻ · 모델이 방금 적었다는 신호(`onRunListChanged`)가 오면 다시 읽는다 */
  refresh: () => void
}

export function useRunList(projectId: string): RunListHandle {
  const [state, setState] = useState<{ entries: RunEntry[]; found: boolean; stale: boolean }>({
    entries: [],
    found: false,
    stale: false,
  })
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)
  const refresh = useCallback(() => setNonce((value) => value + 1), [])

  useEffect(() => {
    // 프로젝트를 옮기는 순간 앞 프로젝트의 목록이 남아 있으면, 사용자는 **남의 프로젝트
    // 명령을 이 프로젝트에서 띄우게 된다.** 읽어 오는 동안 비워 둔다.
    let alive = true
    setLoading(true)
    setState({ entries: [], found: false, stale: false })

    void loadRunList(projectId).then((next) => {
      if (alive) {
        setState(next)
        setLoading(false)
      }
    })
    return () => {
      alive = false
    }
  }, [projectId, nonce])

  // 모델이 `save_run_commands` 로 방금 적었다 — **목록은 안 실려 온다.** 정본은 파일이고
  // 이 신호는 "다시 읽어라" 하나다 (`RUN_LIST_CHANGED`).
  useEffect(
    () => window.davis.onRunListChanged((_payload, from) => (from === projectId ? refresh() : undefined)),
    [projectId, refresh],
  )

  return { ...state, loading, refresh }
}

async function loadRunList(
  projectId: string,
): Promise<{ entries: RunEntry[]; found: boolean; stale: boolean }> {
  const file = await window.davis.readFile({ projectId, path: AGENTS_FILE })
  const section = file.ok ? parseRunSection(file.text) : null
  if (section === null) return { entries: [], found: false, stale: false }

  return {
    entries: section.entries,
    found: true,
    stale: await isStale(projectId, section.manifest),
  }
}

/**
 * 지문이 달라졌나. **지문이 없으면 묻지 않는다** — 사람이 손으로 적은 절에는 이 값이
 * 없고, 우리가 만들지 않은 목록을 우리 판단으로 덮어쓰자고 청할 이유가 없다
 * (`RunSection.manifest` 머리말).
 */
async function isStale(projectId: string, manifest: string | null): Promise<boolean> {
  if (manifest === null) return false

  const found: { path: string; text: string }[] = []
  for (const path of MANIFEST_FILES) {
    const file = await window.davis.readFile({ projectId, path })
    // 없는 파일은 빠진다 — 후보 목록은 여러 생태계를 함께 담고 있어 대부분이 없는 것이 정상이다
    if (file.ok && file.text !== '') found.push({ path, text: file.text })
  }
  return manifestFingerprint(found) !== manifest
}
