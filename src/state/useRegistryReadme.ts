import { useEffect, useRef, useState } from 'react'
import type { RegistryReadmePayload } from '../../shared/ipc/extensionRegistryPayloads'
import type { ReadmeState } from './readmeState'

// 배포처가 내놓은 설명을 **받기 전에** 읽어 온다 (표준 §4.4).
//
// 주소는 목록 문서가 준 것이고, **없으면 부르지 않는다** — 설명을 안 내놓는 배포처(정적
// 파일로 손수 쓴 곳)가 정상이라, 그때는 물어보지 않고 바로 "설명 없음" 으로 앉는다.
// 주소가 있는데 못 받은 것만 오류다.

/**
 * 사유를 사람 말로. 정본은 main 의 `RegistryReadmeFailure` 이고, 모르는 사유는 코드를
 * 그대로 보여준다 — 감추면 사용자가 고칠 수 없다 (`useExtensionReadme` 와 같은 판단).
 */
const FAILURE_LABEL: Record<string, string> = {
  bad_url: '배포처가 알려준 설명 주소가 올바르지 않습니다',
  unreachable: '배포처에 닿지 못했습니다',
  timeout: '배포처가 제때 답하지 않았습니다',
  http_error: '배포처가 설명을 주지 않았습니다',
  too_large: '설명이 너무 커서 여기 싣지 않습니다',
}

export function useRegistryReadme(url: string | undefined): ReadmeState {
  const [state, setState] = useState<ReadmeState>(
    url === undefined ? { kind: 'none' } : { kind: 'loading' },
  )

  // 화면이 사라진 뒤에 도착한 응답으로 상태를 건드리지 않는다
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    if (url === undefined) {
      setState({ kind: 'none' })
      return
    }

    setState({ kind: 'loading' })
    void window.davis
      .fetchExtensionRegistryReadme({ url })
      .then((result: RegistryReadmePayload) => {
        if (!alive.current) return
        setState(
          result.ok
            ? { kind: 'text', text: result.text }
            : {
                kind: 'error',
                message: FAILURE_LABEL[result.reason] ?? `알 수 없는 사유 (${result.reason})`,
              },
        )
      })
      .catch(() => {
        if (alive.current) setState({ kind: 'error', message: '설명을 불러오지 못했습니다' })
      })
  }, [url])

  return state
}
