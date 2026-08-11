import { useState } from 'react'
import type { TurnTokens } from '../../shared/ipc/messageTypes'
import { contextRatioColor, formatPercent, formatTokenCount } from '../utils/formatTokens'

// 턴 토큰 줄 (설계 §6.1 의 6번 — 턴의 **맨 마지막**).
//
// 답변이 있고 턴이 끝났을 때만, 그리고 총 토큰이 0 보다 클 때만 나온다.
// 접으면 요약 한 줄, 펼치면 상세.

export interface TokenUsageProps {
  tokens: TurnTokens | undefined
}

export function TokenUsage({ tokens }: TokenUsageProps) {
  const [expanded, setExpanded] = useState(false)

  const total = tokens?.totalTokens ?? 0
  if (!tokens || total <= 0) return null

  return (
    <div className="cc-token-usage">
      <button type="button" className="cc-token-summary" onClick={() => setExpanded((prev) => !prev)}>
        {summaryParts(tokens).map((part, index) => (
          <span key={part.key} style={part.color ? { color: part.color } : undefined}>
            {index > 0 && <span className="cc-token-separator"> | </span>}
            {part.text}
          </span>
        ))}
      </button>

      {expanded && (
        <dl className="cc-token-detail">
          <Row label="총 토큰:" value={total.toLocaleString()} />
          {tokens.inputTokens !== undefined && (
            <Row label="입력 토큰:" value={tokens.inputTokens.toLocaleString()} />
          )}
          {tokens.outputTokens !== undefined && (
            <Row label="출력 토큰:" value={tokens.outputTokens.toLocaleString()} />
          )}
          {tokens.cost !== undefined && <Row label="비용:" value={`$${tokens.cost.toFixed(4)}`} />}
          {tokens.model && <Row label="모델:" value={tokens.model} />}
          {tokens.durationSec !== undefined && (
            <Row label="소요:" value={`${tokens.durationSec}초`} />
          )}
        </dl>
      )}
    </div>
  )
}

interface SummaryPart {
  key: string
  text: string
  color?: string
}

/** 요약 줄 구성. 컨텍스트 정보가 있으면 그걸 먼저 보여준다. */
function summaryParts(tokens: TurnTokens): SummaryPart[] {
  const parts: SummaryPart[] = []

  if (tokens.contextLength && tokens.contextUsageRatio !== undefined) {
    const used = Math.round(tokens.contextLength * tokens.contextUsageRatio)
    const color = contextRatioColor(tokens.contextUsageRatio)
    parts.push({
      key: 'context',
      text: `컨텍스트: ${formatTokenCount(used)} / ${formatTokenCount(tokens.contextLength)} (${formatPercent(tokens.contextUsageRatio)})`,
      ...(color ? { color } : {}),
    })
  }

  if (tokens.inputTokens !== undefined) {
    parts.push({ key: 'input', text: `입력 누적: ${formatTokenCount(tokens.inputTokens)}` })
  }
  if (tokens.outputTokens !== undefined) {
    parts.push({ key: 'output', text: `출력: ${formatTokenCount(tokens.outputTokens)}` })
  }

  const total = tokens.totalTokens ?? 0
  const costSuffix = tokens.cost !== undefined ? ` · $${tokens.cost.toFixed(4)}` : ''
  parts.push({ key: 'total', text: `${formatTokenCount(total)} 토큰${costSuffix}` })

  return parts
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="cc-token-detail-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
