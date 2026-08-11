import type { SemanticType } from '../../shared/protocol/chunkTypes'

// 청크 필드 읽기 헬퍼.
//
// 청크는 런타임이 보낸 **믿을 수 없는 JSON** 이다. 타입이 맞지 않으면 값을 지어내지 않고
// undefined 를 돌려주고, 호출부는 optional() 로 "없으면 키 자체를 안 넣는" 형태를 만든다.
// exactOptionalPropertyTypes 아래서 `{ key: undefined }` 와 키 부재는 다른 타입이기 때문이다.

/** 값이 있을 때만 키를 만든다. 없으면 빈 객체라 스프레드해도 키가 생기지 않는다. */
export function optional<K extends string, V>(
  key: K,
  value: V | undefined,
): Record<K, V> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>)
}

/** 빈 문자열은 없는 것으로 본다 — 빈 이름·빈 id 는 어차피 쓸 수 없다. */
export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

const SEMANTIC_TYPES: readonly string[] = ['plan', 'tool_summary', 'reflection', 'error', 'reply']

export function asSemanticType(value: unknown): SemanticType | undefined {
  return typeof value === 'string' && SEMANTIC_TYPES.includes(value)
    ? (value as SemanticType)
    : undefined
}

export function parseTimestamp(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
