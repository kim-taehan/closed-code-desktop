import { useCallback, useRef, useState } from 'react'

// 잠깐 떴다 사라지는 알림.
//
// **결과가 화면에 안 보이는 행동에만** 쓴다 — 즐겨찾기·커밋·푸시·되돌리기처럼.
// 파일을 열었을 때처럼 결과가 눈앞에 나타나는 것에는 띄우지 않는다. 그러면
// 알림이 배경 소음이 되어 정작 중요한 것을 놓친다.

export interface Toast {
  id: number
  text: string
  tone: 'info' | 'error'
}

const LIFETIME_MS = 3000

export interface ToastApi {
  toasts: Toast[]
  show: (text: string, tone?: Toast['tone']) => void
  dismiss: (id: number) => void
}

export function useToasts(): ToastApi {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const show = useCallback(
    (text: string, tone: Toast['tone'] = 'info') => {
      const id = (seq.current += 1)
      setToasts((current) => [...current, { id, text, tone }])
      // 오류는 좀 더 오래 둔다 — 읽기도 전에 사라지면 무엇이 틀렸는지 모른다
      setTimeout(() => dismiss(id), tone === 'error' ? LIFETIME_MS * 2 : LIFETIME_MS)
    },
    [dismiss],
  )

  return { toasts, show, dismiss }
}
