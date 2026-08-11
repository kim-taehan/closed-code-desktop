import { useEffect, useRef, useState } from 'react'
import type { ExtensionReadmeResult } from '../../shared/ipc/extensionPayloads'
import type { ReadmeState } from './readmeState'

// **설치된** 확장의 README.md 를 읽어 온다 (디스크). 설정 창 「상세」가 쓴다.
// 배포처에서 받기 전에 보는 설명은 `useRegistryReadme` 다 — 상태 모양은 같다.

/**
 * 사유를 사람 말로. 정본은 main 의 `ReadmeFailure` 이고, 모르는 사유는 코드를 그대로
 * 보여준다 — 감추면 사용자가 고칠 수 없다 (`extensionSkipReason.ts` 와 같은 판단).
 */
const FAILURE_LABEL: Record<string, string> = {
  outside: '확장 이름이 올바르지 않습니다',
  not_file: 'README.md 가 파일이 아닙니다',
  too_large: 'README.md 가 너무 커서 여기 싣지 않습니다',
  unreadable: 'README.md 를 읽지 못했습니다',
}

export function useExtensionReadme(name: string): ReadmeState {
  const [state, setState] = useState<ReadmeState>({ kind: 'loading' })

  // 화면이 사라진 뒤에 도착한 응답으로 상태를 건드리지 않는다
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    setState({ kind: 'loading' })
    void window.davis
      .readExtensionReadme({ name })
      .then((result: ExtensionReadmeResult) => {
        if (!alive.current) return
        if (result.ok) {
          setState({ kind: 'text', text: result.text })
          return
        }
        // 없는 것은 상태지 오류가 아니다
        if (result.reason === 'missing') {
          setState({ kind: 'none' })
          return
        }
        setState({
          kind: 'error',
          message: FAILURE_LABEL[result.reason] ?? `알 수 없는 사유 (${result.reason})`,
        })
      })
      .catch(() => {
        if (alive.current) setState({ kind: 'error', message: '설명을 불러오지 못했습니다' })
      })
  }, [name])

  return state
}
