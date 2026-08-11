import {
  TurnReviewStatus,
  type ChangeBlock,
  type ChangeBlockKind,
  type FileOperation,
  type LineRange,
  type MaybeContent,
  type TurnFileChange,
  type TurnReview,
  type TurnVerification,
  type VerificationStatus,
} from './turnReview'

// turn_changes 페이로드를 우리 모델로 바꾼다.
//
// 이 도메인은 **camelCase 별칭**이다 (_AliasModel) — chat_history 와 다르다.
// 모르는 상태값이나 빠진 필드는 조용히 버리지 않고 안전한 기본값으로 채운다.

export function parseTurnReview(data: unknown): TurnReview | null {
  if (data === null || typeof data !== 'object') return null
  const record = data as Record<string, unknown>

  // 페이로드가 { review: {...} } 로 감싸 오는 경우도 받아준다
  const source = (record['review'] ?? record) as Record<string, unknown>

  const turnId = source['turnId']
  if (typeof turnId !== 'string' || !turnId) return null

  const review: TurnReview = {
    turnId,
    status: parseStatus(source['status']),
    files: parseFiles(source['files']),
  }

  if (typeof source['chatTurnId'] === 'string') review.chatTurnId = source['chatTurnId']
  if (typeof source['isFinalized'] === 'boolean') review.isFinalized = source['isFinalized']

  const verification = parseVerification(source['verification'])
  if (verification) review.verification = verification

  const actions = source['actions']
  if (Array.isArray(actions)) {
    review.actions = actions.filter((action): action is string => typeof action === 'string')
  }

  return review
}

/** 모르는 상태는 진행 중으로 본다 — 버튼을 잘못 열어주는 것보다 안전하다 */
function parseStatus(value: unknown): TurnReviewStatus {
  if (typeof value !== 'string') return TurnReviewStatus.IN_PROGRESS
  // Object.hasOwn 로 막지 않으면 'toString'·'constructor' 같은 프로토타입 키가
  // 상속 함수로 잡혀 truthy 폴백을 우회한다 (열거값이 아닌 함수가 새어 나온다).
  if (!Object.hasOwn(TurnReviewStatus, value)) return TurnReviewStatus.IN_PROGRESS
  return (TurnReviewStatus as Record<string, TurnReviewStatus>)[value] ?? TurnReviewStatus.IN_PROGRESS
}

function parseFiles(value: unknown): TurnFileChange[] {
  if (!Array.isArray(value)) return []
  return value
    .map(parseFile)
    .filter((file): file is TurnFileChange => file !== null)
}

function parseFile(value: unknown): TurnFileChange | null {
  if (value === null || typeof value !== 'object') return null
  const record = value as Record<string, unknown>

  const path = record['path']
  if (typeof path !== 'string' || !path) return null

  const file: TurnFileChange = {
    path,
    operation: parseOperation(record['operation']),
    additions: numberOr(record['additions'], 0),
    deletions: numberOr(record['deletions'], 0),
    openable: record['openable'] !== false,
    baseline: parseContent(record['baseline']),
    modified: parseContent(record['modified']),
    changeBlocks: parseBlocks(record['changeBlocks']),
  }

  if (typeof record['conflictReason'] === 'string') file.conflictReason = record['conflictReason']

  const baseVersion = record['baseVersion']
  if (baseVersion !== null && typeof baseVersion === 'object') {
    const bv = baseVersion as Record<string, unknown>
    if (typeof bv['hash'] === 'string') {
      file.baseVersion = {
        hash: bv['hash'],
        encoding: typeof bv['encoding'] === 'string' ? bv['encoding'] : 'utf-8',
        eol: typeof bv['eol'] === 'string' ? bv['eol'] : '\n',
      }
    }
  }

  return file
}

function parseOperation(value: unknown): FileOperation {
  return value === 'create' || value === 'delete' ? value : 'modify'
}

/** 문자열이면 전문, {ref}면 참조 마커, 그 외는 없음 */
function parseContent(value: unknown): MaybeContent {
  if (typeof value === 'string') return value
  if (value !== null && typeof value === 'object') {
    const ref = (value as Record<string, unknown>)['ref']
    if (typeof ref === 'string') return { ref }
  }
  return null
}

function parseBlocks(value: unknown): ChangeBlock[] {
  if (!Array.isArray(value)) return []

  return value
    .map((raw): ChangeBlock | null => {
      if (raw === null || typeof raw !== 'object') return null
      const record = raw as Record<string, unknown>

      const kind = record['kind']
      if (kind !== 'insert' && kind !== 'delete' && kind !== 'replace') return null

      const oldRange = parseRange(record['oldRange'])
      const newRange = parseRange(record['newRange'])
      if (!oldRange || !newRange) return null

      const block: ChangeBlock = { kind: kind as ChangeBlockKind, oldRange, newRange }
      if (typeof record['deletedText'] === 'string') block.deletedText = record['deletedText']
      return block
    })
    .filter((block): block is ChangeBlock => block !== null)
}

function parseRange(value: unknown): LineRange | null {
  if (value === null || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const startLine = record['startLine']
  const endLine = record['endLine']
  if (typeof startLine !== 'number' || typeof endLine !== 'number') return null
  return { startLine, endLine }
}

function parseVerification(value: unknown): TurnVerification | null {
  if (value === null || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const status = record['status']
  if (status !== 'verified' && status !== 'unverified' && status !== 'not_required') return null

  const verification: TurnVerification = { status: status as VerificationStatus }
  if (typeof record['reason'] === 'string') verification.reason = record['reason']
  if (Array.isArray(record['commands'])) {
    verification.commands = record['commands'].filter((c): c is string => typeof c === 'string')
  }
  return verification
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
