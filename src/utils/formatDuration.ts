// 경과시간 표기 (설계 §6.2).
// 턴 헤더·도구 묶음·도구 행 세 곳이 공유하므로 한곳에만 둔다.
//
// vscode formatTurnDuration (MessageList.tsx:23-29) 과 같은 규칙:
//   null        durationMs 가 없거나 NaN
//   '<1s'       반올림 초가 1 미만
//   '{n}s'      60초 미만
//   '{m}m {s}s' 그 이상

export function formatDuration(durationMs: number | null | undefined): string | null {
  if (durationMs === null || durationMs === undefined || Number.isNaN(durationMs)) return null

  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  if (totalSeconds < 1) return '<1s'
  if (totalSeconds < 60) return `${totalSeconds}s`

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m ${seconds}s`
}

/**
 * 헤더에 실제로 보일 값.
 * 확정된 durationMs 가 있으면 그것을 쓰고,
 * 아직 스트리밍 중이면 시작 시각부터 지금까지를 센다.
 */
export function displayDuration(
  durationMs: number | null | undefined,
  options: { isStreaming: boolean; startedAt?: number; now?: number },
): string | null {
  const settled = formatDuration(durationMs)
  if (settled !== null) return settled
  if (!options.isStreaming || options.startedAt === undefined) return null

  const now = options.now ?? Date.now()
  return formatDuration(now - options.startedAt)
}
