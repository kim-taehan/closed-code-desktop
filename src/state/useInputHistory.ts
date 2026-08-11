import { useCallback, useEffect, useState } from 'react'

// 입력창에서 위/아래로 되짚는 이전 입력 기록. 프로젝트별로 따로 둔다.
//
// 세션이 유지되는 동안만 메모리에 든다 — 앱을 다시 켜면 사라진다 (캐시 성격).
// 그래서 디스크가 아니라 모듈 전역 스토어에 둔다. 프로젝트를 옮겼다 돌아와도
// (ChatComposer 가 다시 마운트돼도) 기록이 남게 하려고 컴포넌트 밖에 둔다.
// (useSidebarWidth 와 같은 판단 — 값 하나 때문에 설정 스토어를 거칠 이유가 없다.)

/** 프로젝트당 보관 상한. 넘으면 오래된 것부터 버린다. */
const CAP = 100

/** projectId → 최근 입력이 앞(index 0) */
const store = new Map<string, string[]>()

export interface InputHistory {
  /** 최근 입력이 앞(index 0). */
  entries: string[]
  /** 전송한 입력을 기록한다. */
  record: (text: string) => void
}

export function useInputHistory(projectId: string | null): InputHistory {
  const [entries, setEntries] = useState<string[]>(() => read(projectId))

  useEffect(() => setEntries(read(projectId)), [projectId])

  const record = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || projectId === null) return
      const current = read(projectId)
      // 바로 직전과 같은 입력은 겹쳐 쌓지 않는다. 같은 옛 입력은 앞으로 끌어올린다.
      if (current[0] === trimmed) return
      const next = [trimmed, ...current.filter((entry) => entry !== trimmed)].slice(0, CAP)
      store.set(projectId, next)
      setEntries(next)
    },
    [projectId],
  )

  return { entries, record }
}

function read(projectId: string | null): string[] {
  return projectId === null ? [] : (store.get(projectId) ?? [])
}
