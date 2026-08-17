import type { ExtensionSkip } from './service'
import type { ExtensionProgressKind, ExtensionProgressLane } from '../../shared/ipc/extensionPayloads'

// `ExtensionService` 가 쓰는 모양 검사·변환만 모았다.
//
// 갈라낸 이유는 응집이 아니라 **자리**다 — `service.ts` 가 300줄 상한에 닿아
// `view.setHtml` 을 얹을 자리가 없었다. 판단(무엇을 싣고 무엇을 답할지)은 전부 저쪽에 남기고,
// 여기에는 **결정을 내리지 않는 함수만** 둔다. 선례: `projectBridge → projectFsHandlers`.

/** 자식이 돌려준 `{ failed }` 를 목록 사유로 옮긴다. 모양이 아니면 빈 배열이다. */
export function toSkips(result: unknown): ExtensionSkip[] {
  const failed = asRecord(result)['failed']
  if (!Array.isArray(failed)) return []
  return failed.flatMap((item) => {
    const source = asRecord(item)
    const dir = source['dir']
    const reason = source['reason']
    if (typeof dir !== 'string' || typeof reason !== 'string') return []
    const detail = source['detail']
    return [
      {
        dir,
        reason: reason as ExtensionSkip['reason'],
        ...(typeof detail === 'string' ? { detail } : {}),
      },
    ]
  })
}

/** 확장이 보낸 인자 하나. 문자열이 아니면 **던진다** — 부르는 쪽이 오류 응답으로 바꾼다. */
export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} 가 문자열이 아닙니다`)
  return value
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

const KINDS: readonly string[] = ['step', 'done', 'fail', 'note']

/**
 * 진행 줄의 성격. **모르는 값은 `undefined` 로 눙친다** — 던지지 않는다.
 *
 * 이 칸은 「쌓을까 갈아치울까」를 가를 뿐이라, 못 알아들으면 기본(갈아치움)으로 두면 된다.
 * 확장 하나가 오타를 냈다고 진행 알림 자체를 실패로 만들 이유가 없다 (알림은 곁다리다).
 */
export function asProgressKind(value: unknown): ExtensionProgressKind | undefined {
  return typeof value === 'string' && KINDS.includes(value) ? (value as ExtensionProgressKind) : undefined
}

/**
 * 겹쳐 도는 갈래들. 배열이 아니거나 모양이 아닌 항목은 **조용히 뺀다.**
 *
 * `startedAt` 이 수가 아니면 그 갈래는 버린다 — 시각이 없으면 화면이 경과를 셀 수 없고,
 * 지금 시각으로 눙치면 방금 시작한 것처럼 보여 **거짓말을 한다.**
 */
export function asProgressLanes(value: unknown): ExtensionProgressLane[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.flatMap((item) => {
    const one = asRecord(item)
    const name = one['name']
    const startedAt = one['startedAt']
    if (typeof name !== 'string' || typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return []
    const doing = one['doing']
    return [{ name, startedAt, ...(typeof doing === 'string' ? { doing } : {}) }]
  })
}
