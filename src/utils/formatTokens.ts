// 토큰 수 표기 (설계 §6.1). vscode MessageTokenUsage 와 같은 규칙.

/** 1M 이상은 M, 1K 이상은 K, 그 아래는 천단위 구분 */
export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return value.toLocaleString()
}

/** 컨텍스트 사용 비율에 따른 경고색. 90% 이상은 위험, 80% 이상은 주의. */
export function contextRatioColor(ratio: number): string | undefined {
  const percent = ratio * 100
  if (percent >= 90) return 'var(--dc-status-error)'
  if (percent >= 80) return 'var(--dc-status-warn)'
  return undefined
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}
