import { MessageKind, type ChatMessage, type TurnMeta } from '../../shared/ipc/messageTypes'
import type { SemanticType } from '../../shared/protocol/chunkTypes'

// 골든 테스트용 고정 입력 (설계 §9.2).
// 실제 청크 흐름이 만들어내는 메시지 배열을 손으로 재현한다.

let sequence = 0
const nextId = () => `m${sequence++}`

export function resetFixtureIds(): void {
  sequence = 0
}

interface TextOptions {
  semanticType?: SemanticType
  interrupted?: boolean
  turnId?: string
}

export function text(content: string, options: TextOptions = {}): ChatMessage {
  return {
    id: nextId(),
    author: 'assistant',
    kind: MessageKind.TEXT,
    content,
    turnId: options.turnId ?? 't1',
    ...(options.semanticType ? { semanticType: options.semanticType } : {}),
    ...(options.interrupted ? { interrupted: true } : {}),
  }
}

export function tool(
  toolName: string,
  options: { done?: boolean; error?: string; turnId?: string } = {},
): ChatMessage {
  const base: ChatMessage = {
    id: nextId(),
    author: 'assistant',
    kind: MessageKind.TOOL_CALL,
    content: '',
    toolName,
    turnId: options.turnId ?? 't1',
    timestamp: new Date(0).toISOString(),
  }
  if (options.error) return { ...base, toolResult: { error: options.error, success: false } }
  if (options.done) return { ...base, toolResult: { message: '완료', success: true } }
  return base
}

/** 추론 버블 (DC-1030). 답변(text)과 별개 kind 다. */
export function thinking(content: string, options: { turnId?: string } = {}): ChatMessage {
  return {
    id: nextId(),
    author: 'assistant',
    kind: MessageKind.THINKING,
    content,
    turnId: options.turnId ?? 't1',
  }
}

export function user(content: string): ChatMessage {
  return { id: nextId(), author: 'user', kind: MessageKind.TEXT, content }
}

export function meta(options: Partial<TurnMeta> = {}): TurnMeta[] {
  return [{ turnId: 't1', terminal: true, ...options }]
}

/** 아직 끝나지 않은 턴 */
export function openMeta(): TurnMeta[] {
  return [{ turnId: 't1', terminal: false }]
}

/**
 * 렌더 결과를 읽기 쉬운 구조 문자열로 바꾼다.
 * 원시 HTML 스냅샷은 클래스 하나만 바뀌어도 통째로 깨져 읽기 어렵다.
 * 여기서는 **구조에 의미 있는 클래스만** 남긴다.
 */
const MEANINGFUL = [
  'cc-turn-header',
  'cc-turn-header--no-toggle',
  'cc-turn-header--clickable',
  'cc-turn-body',
  'cc-turn-body--expanded',
  'cc-turn-toggle',
  'cc-assistant-message',
  'cc-user-message',
  'cc-interrupted-label',
  'cc-token-usage',
  'taz-area',
  'taz-area--single',
  'taz-area--group',
  'taz-counter',
  'taz-item',
  'message-error',
  'thinking-block',
  'cc-rail-end',
]

export function describeStructure(root: Element, depth = 0): string {
  const lines: string[] = []

  for (const child of Array.from(root.children)) {
    const classes = Array.from(child.classList).filter((name) => MEANINGFUL.includes(name))
    const isMeaningful = classes.length > 0

    if (isMeaningful) {
      const label = classes.join('.')
      const inline = directText(child)
      lines.push(`${'  '.repeat(depth)}${label}${inline ? ` "${inline}"` : ''}`)
      lines.push(describeStructure(child, depth + 1))
    } else {
      // 의미 없는 래퍼는 건너뛰고 그 안쪽을 같은 깊이로 이어붙인다
      lines.push(describeStructure(child, depth))
    }
  }

  return lines.filter(Boolean).join('\n')
}

/**
 * 구조 문자열에서 특정 노드 개수를 센다.
 * 단순 정규식은 `cc-turn-header` 가 `cc-turn-header--clickable` 에도 걸려 중복 계산된다.
 * 각 줄의 **첫 클래스**만 보고 센다.
 */
export function countNodes(structure: string, className: string): number {
  return structure
    .split('\n')
    .map((line) => line.trim().split(' ')[0]?.split('.')[0] ?? '')
    .filter((first) => first === className).length
}

/** 자식 요소를 뺀 직접 텍스트. 너무 길면 줄인다. */
function directText(element: Element): string {
  const own = Array.from(element.childNodes)
    .filter((node) => node.nodeType === 3)
    .map((node) => node.textContent?.trim() ?? '')
    .join(' ')
    .trim()
  return own.length > 40 ? `${own.slice(0, 40)}…` : own
}
