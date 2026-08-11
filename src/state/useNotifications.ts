import { useEffect } from 'react'
import { notificationText } from '../../shared/protocol/notification'
import type { ToastApi } from './useToasts'

// 사용자 알림(kind=notification)을 토스트로 띄운다. ADR-053.
//
// **공지 배너와 다른 자리에 둔다.** 공지는 전원 대상 게시물이라 상단 배너가 맞지만,
// 이것은 내가 시킨 일의 결과라 하던 일을 가리면 안 된다 — 오른쪽 아래 토스트로 흘린다.
//
// 큐를 쌓지 않는다. useToasts 가 이미 여러 건을 겹쳐 쌓고 스스로 걷어낸다.

export function useNotifications(
  projectId: string | null,
  toasts: ToastApi,
  enabled: boolean,
): void {
  useEffect(() => {
    if (projectId === null || !enabled) return
    return window.davis.onNotification((notification, id) => {
      if (id !== projectId) return
      // tone 은 info 하나만 쓴다. useToasts 의 error 는 빨간 표시라 표시 시간을 늘리려고
      // 빌려 쓰면 성공 알림이 실패처럼 보인다 — status(proactive)는 색으로 나누지 않는다.
      toasts.show(notificationText(notification))
    })
  }, [projectId, toasts, enabled])
}
