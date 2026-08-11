import { useState } from 'react'
import type { TurnMeta, TurnTokens } from '../../shared/ipc/messageTypes'
import { contextRatioColor, formatPercent, formatTokenCount } from '../utils/formatTokens'
import { t } from '../i18n/messages'

// 세션 컨텍스트 사용량 바 (DC-987/1019 대응).
//
// 턴 줄(TokenUsage)은 끝난 턴마다 접혀 있어 "지금 얼마나 찼는가"가 한눈에 안 보인다.
// 이 바는 입력창 위에 **상시** 떠서 최신 컨텍스트 사용률을 보여준다.
// 데이터는 stream_end 가 이미 실어 오는 것을 그대로 쓴다 — 새 요청은 없다.

export interface ContextUsageBarProps {
  turnMetas: TurnMeta[]
}

export function ContextUsageBar({ turnMetas }: ContextUsageBarProps) {
  const [open, setOpen] = useState(false)

  const tokens = latestTokens(turnMetas)
  const contextLength = tokens?.contextLength ?? 0
  if (!tokens || contextLength <= 0) return null

  const ratio = tokens.contextUsageRatio ?? 0
  const used = tokens.lastInputTokens ?? Math.round(contextLength * ratio)
  const color = warnColor(tokens.usageWarningLevel) ?? contextRatioColor(ratio)

  return (
    <div className="context-bar">
      <button
        type="button"
        className="context-bar__summary"
        title={t('세션 컨텍스트 사용량 — 눌러서 상세')}
        onClick={() => setOpen((previous) => !previous)}
      >
        <span className="context-bar__track" aria-hidden>
          <span
            className="context-bar__fill"
            style={{ width: `${Math.min(100, Math.round(ratio * 100))}%`, ...(color ? { background: color } : {}) }}
          />
        </span>
        <span className="context-bar__label" style={color ? { color } : undefined}>
          {t('컨텍스트')} {formatTokenCount(used)} / {formatTokenCount(contextLength)} ({formatPercent(ratio)})
        </span>
      </button>

      {open && <Breakdown tokens={tokens} />}
    </div>
  )
}

/** 카테고리 분해 + 유효 윈도우. 런타임이 안 보내면 항목이 그냥 빠진다. */
function Breakdown({ tokens }: { tokens: TurnTokens }) {
  const rows: Array<[string, number | undefined]> = [
    [t('시스템 프롬프트'), tokens.contextBreakdown?.systemPrompt],
    [t('에이전트 설정'), tokens.contextBreakdown?.agent],
    [t('메모리'), tokens.contextBreakdown?.memory],
    [t('스킬'), tokens.contextBreakdown?.skills],
    [t('대화 기록'), tokens.contextBreakdown?.conversation],
    [t('도구 결과'), tokens.contextBreakdown?.toolResults],
    [t('유효 작업 윈도우'), tokens.effectiveWorkingWindow],
  ]
  const visible = rows.filter((row): row is [string, number] => row[1] !== undefined && row[1] > 0)
  if (visible.length === 0) return null

  return (
    <dl className="context-bar__detail">
      {visible.map(([label, value]) => (
        <div key={label} className="context-bar__row">
          <dt>{label}</dt>
          <dd>{formatTokenCount(value)}</dd>
        </div>
      ))}
    </dl>
  )
}

/** 가장 최근에 토큰이 기록된 턴의 값 — 그게 현재 세션 상태다 */
function latestTokens(turnMetas: TurnMeta[]): TurnTokens | undefined {
  for (let index = turnMetas.length - 1; index >= 0; index -= 1) {
    const tokens = turnMetas[index]?.tokens
    if (tokens && (tokens.contextLength ?? 0) > 0) return tokens
  }
  return undefined
}

/** 런타임이 판정한 경고 단계가 있으면 그걸 우선한다 (DC-1019) */
function warnColor(level: string | undefined): string | undefined {
  if (level === 'danger') return 'var(--dc-status-error)'
  if (level === 'caution') return 'var(--dc-status-warn)'
  return undefined
}
