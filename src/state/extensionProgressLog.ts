import type { ExtensionProgressPayload } from '../../shared/ipc/channels'

// 확장이 알린 진행 줄 중 **쌓이는 것**만 모은다.
//
// 사이드바의 진행 표시는 한 줄이었다 — 다음 줄이 오면 앞 줄이 사라진다. 수 분에서 한 시간까지
// 도는 명령에서 그것은 **아무것도 안 남는다**는 뜻이다: 자리를 비웠다 돌아오면 무엇이 됐고
// 무엇이 실패했는지 화면 어디에도 없다 (실측 불만: *"오래 걸리는데 프로세스 진행사항을 알 수가 없네"*).
//
// 무엇을 쌓을지는 **확장이 정한다** (`kind`). 「…하는 중」과 「대상 하나가 끝났다」는 수명이
// 다르고, 그 차이를 아는 것은 확장뿐이다. 여기서 글을 보고 짐작하지 않는다.

/** 쌓인 줄 하나. */
export interface ExtensionProgressLine {
  /** 받은 시각 (epoch ms). **보낸 시각이 아니다** — 확장은 시각을 싣지 않는다 */
  at: number
  kind: 'done' | 'fail' | 'note'
  text: string
}

/** 확장 이름 → 그 확장이 쌓아 둔 줄들. */
export type ExtensionProgressLog = Record<string, { lines: ExtensionProgressLine[]; closed: boolean }>

/**
 * 들고 있을 줄 수의 상한.
 *
 * 사이드바가 보여 주는 것은 마지막 몇 줄뿐이지만, 그보다는 넉넉히 쥔다 — 창을 키우거나
 * 나중에 펼쳐 볼 여지를 위해서다. 전부 보는 자리는 본문 탭이므로(`core/render/progress.js`)
 * 여기서 900개짜리 목록을 통째로 들고 있을 이유는 없다.
 */
export const LOG_KEEP = 40

/**
 * 새 알림 하나를 반영한 로그. **다른 확장의 칸은 건드리지 않는다.**
 *
 * 세 갈래다:
 * - 쌓이지 않는 줄(`step`·없음) → 그대로 둔다. 그 줄은 「지금 한 줄」이 이미 말하고 있다
 * - `text === null`(끝났다) → **지우지 않고 닫아만 둔다.** 무엇이 실패했는지 보는 자리라,
 *   끝났다고 비우면 돌아온 사람에게는 처음부터 아무 일도 없던 것과 같다
 * - 닫힌 뒤 새 줄 → **거기서 비운다.** 판이 바뀌었다는 신호가 그것뿐이다 (확장은 「시작한다」를
 *   따로 알리지 않는다). 두 판이 섞이면 어느 줄이 이번 것인지 사람이 가릴 수 없다
 */
export function applyProgressLine(
  log: ExtensionProgressLog,
  payload: ExtensionProgressPayload,
  at: number,
): ExtensionProgressLog {
  const before = log[payload.extension]

  if (payload.text === null) {
    if (before === undefined || before.closed) return log
    return { ...log, [payload.extension]: { lines: before.lines, closed: true } }
  }

  const kind = payload.kind
  if (kind === undefined || kind === 'step') return log

  const kept = before === undefined || before.closed ? [] : before.lines
  const lines = [...kept, { at, kind, text: payload.text }].slice(-LOG_KEEP)
  return { ...log, [payload.extension]: { lines, closed: false } }
}

/** 그 확장이 쌓아 둔 줄. 없으면 빈 배열 — 부르는 쪽이 `undefined` 를 가르지 않게. */
export function linesOf(log: ExtensionProgressLog, extension: string): ExtensionProgressLine[] {
  return log[extension]?.lines ?? []
}
