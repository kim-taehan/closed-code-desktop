import { useState } from 'react'
import { TurnFileDiff } from './TurnFileDiff'
import {
  STATUS_LABEL,
  isFinalState,
  isProvisional,
  needsManualResolution,
  routableActions,
  totalChanges,
  TurnReviewStatus,
  type FileOperation,
  type TurnFileChange,
  type TurnReview,
} from '../../shared/protocol/turnReview'

// 턴 리뷰 카드 — 턴의 5번 자리 (설계 §6.1 에서 비워둔 그 자리).
//
// 런타임이 이미 파일을 썼다. 이 카드는 "무엇이 바뀌었나" 를 보여주고
// 받아들일지(유지) 되돌릴지(복원)를 정하는 곳이다.

const OPERATION_MARK: Record<FileOperation, string> = {
  create: 'C',
  modify: 'M',
  delete: 'D',
}

export interface TurnReviewPanelProps {
  review: TurnReview
  /** 마지막 턴만 조작할 수 있다 — 옛 카드는 보기만 한다 */
  actionsDisabled?: boolean
  onDecide: (turnId: string, decision: 'accept' | 'reject', filePaths?: string[]) => void
  /** 두 번째 인자는 첫 변경 지점의 줄 번호다 — 파일 맨 위가 아니라 거기서 시작한다. */
  onOpenFile?: (path: string, revealLine?: number) => void
}

export function TurnReviewPanel({
  review,
  actionsDisabled = false,
  onDecide,
  onOpenFile,
}: TurnReviewPanelProps) {
  // 열어본 파일만 펼친다 — 전부 펼치면 긴 변경에서 카드가 화면을 덮는다
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())

  const toggleFile = (path: string) =>
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const provisional = isProvisional(review)
  const totals = totalChanges(review)
  const live = !actionsDisabled && !isFinalState(review)

  // 어떤 버튼을 낼지는 런타임이 정한다 (DC-1214). 상태로 다시 추론하지 않는다.
  const routable = live ? routableActions(review) : []
  const canAccept = routable.includes('accept')
  const canReject = routable.includes('reject')
  const manualOnly = live && needsManualResolution(review)

  const accepted =
    review.status === TurnReviewStatus.ACCEPTED || review.status === TurnReviewStatus.USER_ACKED
  const rejected = review.status === TurnReviewStatus.REJECTED

  return (
    <div className={`turn-review${provisional ? ' turn-review--provisional' : ''}`}>
      <div className="turn-review-head">
        <span className="turn-review-title">변경 사항</span>
        <span className={`turn-review-badge turn-review-badge--${review.status.toLowerCase()}`}>
          {STATUS_LABEL[review.status]}
        </span>
        <VerificationBadge review={review} />
        <span className="turn-review-totals">
          <span className="turn-review-add">+{totals.additions}</span>
          <span className="turn-review-del">−{totals.deletions}</span>
        </span>
      </div>

      <ul className="turn-review-files">
        {review.files.map((file) => (
          <li key={file.path} className="turn-review-file-item">
            <div className="turn-review-file">
              <button
                type="button"
                className="turn-review-expand"
                title={expanded.has(file.path) ? '변경 접기' : '변경 보기'}
                onClick={() => toggleFile(file.path)}
              >
                {expanded.has(file.path) ? '▼' : '▶'}
              </button>
              <span className={`turn-review-op turn-review-op--${file.operation}`}>
                {OPERATION_MARK[file.operation]}
              </span>
              <button
                type="button"
                className="turn-review-path"
                disabled={!file.openable || !onOpenFile}
                onClick={() =>
                  onOpenFile ? onOpenFile(file.path, firstChangeLine(file)) : toggleFile(file.path)
                }
                title={file.conflictReason ?? file.path}
              >
                {file.path}
              </button>
            <span className="turn-review-file-counts">
              <span className="turn-review-add">+{file.additions}</span>
              <span className="turn-review-del">−{file.deletions}</span>
            </span>
              {canReject && (
                <button
                  type="button"
                  className="turn-review-undo"
                  title="이 파일만 되돌리기"
                  onClick={() => onDecide(review.turnId, 'reject', [file.path])}
                >
                  되돌리기
                </button>
              )}
            </div>
            {/* 충돌 사유는 왜 막혔는지 알려주는 유일한 단서다 — title 속성에만 두면 닿지 않는다 */}
            {file.conflictReason && (
              <p className="turn-review-conflict-reason">{file.conflictReason}</p>
            )}
            {expanded.has(file.path) && <TurnFileDiff file={file} />}
          </li>
        ))}
      </ul>

      {manualOnly && <ManualResolutionNote canReject={canReject} />}

      {(canAccept || canReject) && (
        <div className="turn-review-actions">
          {canAccept && (
            <button
              type="button"
              className="turn-review-accept"
              disabled={accepted && !provisional}
              onClick={() => onDecide(review.turnId, 'accept')}
            >
              적용{accepted ? ' ✓' : ''}
            </button>
          )}
          {canReject && (
            <button
              type="button"
              className="turn-review-reject"
              disabled={rejected && !provisional}
              onClick={() => onDecide(review.turnId, 'reject')}
            >
              거부{rejected ? ' ✓' : ''}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 첫 변경 지점의 줄 번호 (변경 후 기준).
 *
 * **런타임이 준 범위를 그대로 쓴다** — diff 를 우리가 다시 계산하지 않는다는 이 계약의
 * 전제(turnReview.ts 머리말)가 여기에도 그대로다. 블록이 없으면(신규 파일 등) 주지 않고,
 * 뷰어는 종전대로 맨 위를 보여준다.
 */
function firstChangeLine(file: TurnFileChange): number | undefined {
  return file.changeBlocks[0]?.newRange.startLine
}

/**
 * 충돌 안내 (DC-1214). 자동 해소 경로가 런타임에 없으므로 다음 행동을 글로 알린다.
 * 죽은 버튼을 두는 것보다 무엇을 해야 하는지 말해 주는 편이 낫다.
 */
function ManualResolutionNote({ canReject }: { canReject: boolean }) {
  return (
    <p className="turn-review-note" role="status">
      {canReject
        ? '파일이 이 턴 밖에서 바뀌어 그대로 적용할 수 없습니다. 편집기에서 직접 정리하거나, 거부로 되돌리세요.'
        : '파일이 이 턴 밖에서 바뀌어 자동으로 정리할 수 없습니다. 편집기에서 직접 확인해 마무리하세요.'}
    </p>
  )
}

/** 검증 배지 (ADR-037). 정보성이며 수락을 막지 않는다. */
function VerificationBadge({ review }: { review: TurnReview }) {
  const verification = review.verification
  if (!verification || verification.status === 'not_required') return null

  if (verification.status === 'verified') {
    return (
      <span
        className="turn-review-verify turn-review-verify--ok"
        title={verification.commands?.join('\n') ?? '검증됨'}
      >
        검증됨
      </span>
    )
  }

  return (
    <span
      className="turn-review-verify turn-review-verify--warn"
      title={verification.reason ?? '사유 미상'}
    >
      미검증
    </span>
  )
}
