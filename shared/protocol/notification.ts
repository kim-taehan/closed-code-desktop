// 사용자 대면 알림 (kind=notification, action=notify). ADR-053.
//
// runtime 이 요청 없이 밀어 넣는 단일 채널이다 — replyTo 가 없다.
// 골든 픽스처: davis-code-runtime/tests/protocol_fixtures/fixtures/notification.notify.*.s2c.json
//
// 공지(announcement)와 다르다. 공지는 백엔드가 전원에게 보내는 게시물이고,
// 이것은 **내 작업**이 끝났거나 배경에서 뭔가 찾았을 때 나에게만 오는 것이다.

/** agent | loop — 누가 보냈나. 픽스처에 없는 값도 그대로 통과시킨다(무해). */
export type NotificationSource = string

/**
 * normal    — 내가 시킨 일의 결과
 * proactive — 내가 시키지 않았는데 알려오는 것 (예약 감사·루프 종료)
 */
export type NotificationStatus = 'normal' | 'proactive'

export interface UserNotification {
  /** 없을 수 있다 (픽스처 loop_end·proactive 는 title: null) */
  title: string | null
  message: string
  source: NotificationSource
  status: NotificationStatus
  /** 루프 id 등 되짚을 대상. 없으면 null */
  refId: string | null
  /** 결과물 경로. 없으면 빈 배열 */
  attachments: string[]
}

/**
 * WS data 를 UserNotification 으로 판다. 모양이 안 맞으면 null.
 *
 * message 가 없으면 버린다 — 제목은 없어도 되지만(픽스처 2건이 title: null)
 * 본문이 없으면 띄울 것이 없다.
 */
export function parseNotification(data: unknown): UserNotification | null {
  if (data === null || typeof data !== 'object') return null
  const record = data as Record<string, unknown>

  const message = str(record['message'])
  if (message === '') return null

  const title = str(record['title'])

  return {
    title: title === '' ? null : title,
    message,
    source: str(record['source']) || 'agent',
    status: record['status'] === 'proactive' ? 'proactive' : 'normal',
    refId: str(record['refId']) || null,
    attachments: strings(record['attachments']),
  }
}

/** 토스트 한 줄로 합친다. 제목이 있으면 앞에 붙인다. */
export function notificationText(notification: UserNotification): string {
  return notification.title === null
    ? notification.message
    : `${notification.title} — ${notification.message}`
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
