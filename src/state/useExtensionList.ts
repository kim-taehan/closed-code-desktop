import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ExtensionEntryPayload,
  ExtensionInstallPayload,
  SkippedExtensionPayload,
} from '../../shared/ipc/channels'

// 설치된 확장 목록을 물어오고, 디스크에서 설치한다.
//
// 목록을 캐시하지 않는다 — 사용자가 앱 밖에서 확장 폴더를 지우거나 넣을 수 있고,
// main 쪽 훑기가 디렉토리 한 겹이라 싸다. 화면을 열 때마다 다시 묻는다.
//
// 설치 뒤 목록을 **다시 읽는다.** 설치 결과만 화면에 반영하면, 방금 설치한 것이
// 훑기에서 걸러졌을 때(권한·깨진 매니페스트) 목록과 어긋난다.

export interface ExtensionListHandle {
  extensions: ExtensionEntryPayload[]
  skipped: SkippedExtensionPayload[]
  loading: boolean
  /** 설치 중에는 버튼을 막아 같은 파일이 두 번 들어가지 않게 한다 */
  installing: boolean
  /** 마지막 행동의 결과. 화면이 한 줄로 알린다 */
  notice: string | null
  installFromDisk: () => void
  /** 켜고 끈다. 목록에는 그대로 남고 명령·뷰만 사라진다 */
  setEnabled: (name: string, enabled: boolean) => void
  /** 폴더째 지운다. 되돌릴 수 없어 확인은 **화면이 먼저** 받는다 */
  uninstall: (dir: string) => void
  refresh: () => void
}

export function useExtensionList(active: boolean): ExtensionListHandle {
  const [extensions, setExtensions] = useState<ExtensionEntryPayload[]>([])
  const [skipped, setSkipped] = useState<SkippedExtensionPayload[]>([])
  const [loading, setLoading] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  // 화면이 사라진 뒤에 도착한 응답으로 상태를 건드리지 않는다
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const refresh = useCallback(() => {
    setLoading(true)
    void window.davis
      .listExtensions()
      .then((list) => {
        if (!alive.current) return
        setExtensions(list.extensions)
        setSkipped(list.skipped)
      })
      .finally(() => {
        if (alive.current) setLoading(false)
      })
  }, [])

  // 분류를 열 때 한 번. 안 보고 있는 동안 훑을 이유가 없다
  useEffect(() => {
    if (active) refresh()
  }, [active, refresh])

  const installFromDisk = useCallback(() => {
    setInstalling(true)
    setNotice(null)
    void window.davis
      .installExtensionFromDisk()
      .then((result) => {
        if (!alive.current) return
        const message = describeInstall(result)
        setNotice(message)
        // 취소가 아니면 목록이 달라졌을 수 있다
        if (message !== null) refresh()
      })
      .finally(() => {
        if (alive.current) setInstalling(false)
      })
  }, [refresh])

  /**
   * 켜고 끄기. **끝난 뒤 목록을 다시 읽는다** — main 이 설정에 남기고 호스트를 다시 싣는데,
   * 화면이 제 상태만 뒤집으면 그 둘이 실패했을 때 어긋난 채로 남는다.
   */
  const setEnabled = useCallback(
    (name: string, enabled: boolean) => {
      setNotice(null)
      void window.davis
        .setExtensionEnabled({ name, enabled })
        .catch(() => {
          if (alive.current) setNotice('확장을 켜고 끄지 못했습니다.')
        })
        .finally(() => {
          if (alive.current) refresh()
        })
    },
    [refresh],
  )

  const uninstall = useCallback(
    (dir: string) => {
      setNotice(null)
      void window.davis
        .uninstallExtension({ dir })
        .then((result) => {
          if (!alive.current) return
          if (!result.ok) {
            const detail = result.detail ? ` (${result.detail})` : ''
            setNotice(
              `${UNINSTALL_FAILURE_LABEL[result.reason] ?? `지우지 못했습니다 (${result.reason})`}${detail}`,
            )
            return
          }
          setNotice('확장을 지웠습니다.')
        })
        .catch(() => {
          if (alive.current) setNotice('확장을 지우지 못했습니다.')
        })
        .finally(() => {
          if (alive.current) refresh()
        })
    },
    [refresh],
  )

  return {
    extensions,
    skipped,
    loading,
    installing,
    notice,
    installFromDisk,
    setEnabled,
    uninstall,
    refresh,
  }
}

/** 정본은 `electron/extensions/uninstall.ts` 의 `UninstallFailure` 다. */
const UNINSTALL_FAILURE_LABEL: Record<string, string> = {
  outside: '설치 폴더 밖은 지우지 않습니다',
  missing: '이미 없는 확장입니다',
  failed: '폴더를 지우지 못했습니다',
}

/**
 * 설치 결과를 사람 말로. 취소는 **아무 말도 하지 않는다** — 사용자가 스스로 그만둔 것이라
 * 알릴 것이 없다. 오류로 뭉뚱그리면 아무것도 안 한 사람에게 실패를 보여주게 된다.
 */
function describeInstall(result: ExtensionInstallPayload): string | null {
  if (result.ok) return `${result.name} ${result.version} 을(를) 설치했습니다.`
  if (result.cancelled) return null
  const detail = result.detail ? ` (${result.detail})` : ''
  return `${INSTALL_FAILURE_LABEL[result.reason] ?? `설치하지 못했습니다 (${result.reason})`}${detail}`
}

/**
 * 설치 실패 사유. 사유가 늘면 여기 한 줄을 더한다 —
 * 정본은 `electron/extensions/install.ts` 의 `InstallFailure` 다.
 *
 * 모르는 사유는 코드를 그대로 보여준다. 감추면 사용자가 고칠 수 없다.
 */
const INSTALL_FAILURE_LABEL: Record<string, string> = {
  unreadable_package: '확장 패키지가 아닙니다',
  unsafe_entry: '패키지 안에 설치 폴더 밖을 가리키는 경로가 있습니다',
  extract_failed: '패키지를 푸는 데 실패했습니다',
  no_manifest: '패키지 안에 manifest.json 이 없습니다',
  invalid_json: 'manifest.json 이 JSON 형식이 아닙니다',
  invalid_manifest: 'manifest.json 이 확장 규격에 맞지 않습니다',
  move_failed: '설치 폴더로 옮기지 못했습니다',
}
