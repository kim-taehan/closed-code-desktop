import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RegistryEntry } from '../../shared/extensions/registryIndex'
import type { RegistryFetchPayload } from '../../shared/ipc/extensionRegistryPayloads'
import { REGISTRY_ADD_FAILURE_LABEL, describeRegistryFailure } from './extensionRegistryReason'

// 배포처 주소를 기억하고, 고른 배포처의 목록 문서를 조회한다.
//
// 결과를 캐시하지 않는다 — 배포처는 앱 밖에서 언제든 바뀐다. 분류를 열 때와
// "다시 조회" 를 누를 때만 묻는다. 조회는 네트워크라 매 렌더마다 하지 않는다.
//
// **한 배포처가 실패해도 나머지는 살린다.** 여러 곳을 한꺼번에 볼 때(전체 배포처)
// 못 닿는 곳 하나 때문에 화면 전체가 비면 사용자는 남은 배포처의 확장도 못 본다.

/** 목록의 한 줄 — 확장 하나 + 어느 배포처에서 왔는지. */
export interface RegistryRow {
  /** 어느 배포처인지. 같은 확장을 여러 배포처가 줄 수 있어 열쇠에도 쓴다 */
  url: string
  /** 화면에 보일 배포처 이름. 목록 문서에 없으면 주소로 대신한다 (표준 §4.4) */
  registryName: string
  entry: RegistryEntry
}

/** 못 읽은 배포처. 주소로 알린다 — 이름은 목록 문서 안에 있어서 실패하면 모른다. */
export interface RegistryFailure {
  url: string
  message: string
}

export interface ExtensionRegistryHandle {
  urls: string[]
  /** `null` 이면 전체 배포처 */
  selected: string | null
  select: (url: string | null) => void
  rows: RegistryRow[]
  failures: RegistryFailure[]
  loading: boolean
  /** 배포처 이름 표. 주소 → 이름. 아직 조회 전이면 없다 */
  namesByUrl: Record<string, string>
  /** 성공하면 `true`. 부르는 쪽이 입력칸을 비우는 데 쓴다 */
  addUrl: (url: string) => Promise<boolean>
  removeUrl: (url: string) => void
  refresh: () => void
  /** 마지막 등록 시도의 결과. 성공이면 `null` */
  notice: string | null
}

export function useExtensionRegistry(active: boolean): ExtensionRegistryHandle {
  const [urls, setUrls] = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [results, setResults] = useState<RegistryFetchPayload[]>([])
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  // 값이 아니라 "다시 물어봐" 라는 신호다. 목록·선택이 그대로여도 조회를 다시 돌린다
  const [nonce, setNonce] = useState(0)

  // 화면이 사라진 뒤에 도착한 응답으로 상태를 건드리지 않는다
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    if (!active) return
    void window.davis.listExtensionRegistries().then((payload) => {
      if (alive.current) setUrls(payload.urls)
    })
  }, [active])

  // 고른 배포처가 목록에서 빠졌으면(삭제) 전체로 되돌린다
  const targets = useMemo(() => {
    if (selected === null) return urls
    return urls.includes(selected) ? [selected] : []
  }, [urls, selected])

  useEffect(() => {
    if (!active || targets.length === 0) {
      setResults([])
      return
    }
    // 조회 중에 대상이 바뀌면 먼저 시작한 쪽의 결과를 버린다 — 늦게 온 응답이 덮어쓰지 않게
    let stale = false
    setLoading(true)
    void Promise.all(targets.map((url) => window.davis.fetchExtensionRegistry({ url })))
      .then((list) => {
        if (!stale && alive.current) setResults(list)
      })
      .finally(() => {
        if (!stale && alive.current) setLoading(false)
      })
    return () => {
      stale = true
    }
  }, [active, targets, nonce])

  const rows = useMemo(
    () =>
      results.flatMap((result) =>
        result.ok
          ? result.index.entries.map((entry) => ({
              url: result.url,
              registryName: result.index.name ?? result.url,
              entry,
            }))
          : [],
      ),
    [results],
  )

  const failures = useMemo(
    () =>
      results.flatMap((result) =>
        result.ok
          ? []
          : [{ url: result.url, message: describeRegistryFailure(result.reason, result.detail) }],
      ),
    [results],
  )

  const namesByUrl = useMemo(() => {
    const names: Record<string, string> = {}
    for (const result of results) {
      if (result.ok && result.index.name !== undefined) names[result.url] = result.index.name
    }
    return names
  }, [results])

  const addUrl = useCallback(async (raw: string): Promise<boolean> => {
    const result = await window.davis.addExtensionRegistry({ url: raw })
    if (!alive.current) return result.ok
    if (!result.ok) {
      setNotice(describeRegistryFailure(result.reason, undefined, REGISTRY_ADD_FAILURE_LABEL))
      return false
    }
    setNotice(null)
    setUrls(result.urls)
    return true
  }, [])

  const removeUrl = useCallback((url: string) => {
    void window.davis.removeExtensionRegistry({ url }).then((payload) => {
      if (!alive.current) return
      setNotice(null)
      setUrls(payload.urls)
    })
  }, [])

  const refresh = useCallback(() => setNonce((value) => value + 1), [])

  return {
    urls,
    selected,
    select: setSelected,
    rows,
    failures,
    loading,
    namesByUrl,
    addUrl,
    removeUrl,
    refresh,
    notice,
  }
}
