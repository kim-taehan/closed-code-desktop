import type { Toast } from '../state/useToasts'

// 오른쪽 아래에 쌓이는 알림.
//
// 스스로 사라지지만 눌러서 지울 수도 있다 — 여러 개가 겹치면 기다리기 답답하다.

export interface ToastStackProps {
  toasts: Toast[]
  onDismiss: (id: number) => void
}

export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) return null

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          className={`toast toast--${toast.tone}`}
          onClick={() => onDismiss(toast.id)}
        >
          {toast.text}
        </button>
      ))}
    </div>
  )
}
