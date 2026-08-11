import { useCallback, useEffect, useRef, useState } from 'react'
import type { RegistryEntry } from '../../shared/extensions/registryIndex'
import { REGISTRY_INSTALL_FAILURE_LABEL, describeRegistryFailure } from './extensionRegistryReason'

// 배포처의 한 줄을 내려받아 설치한다.
//
// **줄 단위로 잠근다.** 배포처가 여러 개면 하나를 받는 동안 목록 전체가 굳을 이유가 없다.
// 다만 같은 줄을 두 번 누르면 같은 폴더에 두 번 풀리므로 그 줄은 막는다.
//
// 성공했다고 목록을 직접 고치지 않는다 — `onInstalled` 로 설치 목록을 **다시 읽게** 한다.
// 배포처가 적은 이름·버전과 패키지 안 매니페스트가 어긋날 수 있어서, 화면이 배포처 말만
// 믿고 그리면 실제 설치본과 달라진다 (`useExtensionList` 가 디스크 설치에서 하는 것과 같다).

/** 이 훅이 목록의 한 줄에서 필요한 것만. `RegistryRow` 가 이 모양을 만족한다. */
export interface InstallTarget {
  url: string
  entry: RegistryEntry
}

export interface RegistryInstallHandle {
  /** 설치 중인 줄의 열쇠. 없으면 `null` */
  busy: string | null
  /** 마지막 시도의 결과. 성공·실패 모두 한 줄로 알린다 */
  notice: string | null
  run: (target: InstallTarget) => void
}

export function useRegistryInstall(onInstalled?: () => void): RegistryInstallHandle {
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // 화면이 사라진 뒤에 도착한 응답으로 상태를 건드리지 않는다
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const run = useCallback(
    (target: InstallTarget) => {
      const key = `${target.url}\n${target.entry.name}`
      // `latest` 가 `versions` 에 있는 것은 파서가 보장한다 — 없는 항목은 `missing_latest`
      // 로 걸러져 목록에 오지 못한다 (`shared/extensions/registryIndex.ts`)
      const picked = target.entry.versions.find((item) => item.version === target.entry.latest)!

      setBusy(key)
      setNotice(null)
      void window.davis
        .installExtensionFromRegistry({ url: picked.url })
        .then((result) => {
          if (!alive.current) return
          if (result.ok) {
            // 배포처가 적은 것이 아니라 **패키지 매니페스트**에서 온 이름·버전이다
            setNotice(`${result.name} ${result.version} 을(를) 설치했습니다.`)
            onInstalled?.()
            return
          }
          setNotice(
            describeRegistryFailure(result.reason, result.detail, REGISTRY_INSTALL_FAILURE_LABEL),
          )
        })
        .finally(() => {
          if (alive.current) setBusy(null)
        })
    },
    [onInstalled],
  )

  return { busy, notice, run }
}
