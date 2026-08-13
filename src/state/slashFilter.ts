// `/` 목록 매칭 규칙.
//
// 표시명과 매칭키가 어긋나지 않도록 **규칙은 이 파일 한 곳에만 둔다** (팝업이 보여 주는
// 것과 전송이 찾는 것이 갈리면, 눈에 보이는 항목을 골랐는데 안 먹는 일이 생긴다).

/** 대소문자·`_`·`-`·연속 공백을 한 가지로 접는다. */
export function normalize(value: string): string {
  return value.toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim()
}

export interface SlashItem {
  /** 팝업에 보일 이름 */
  display: string
  description: string
}

/** 이름·설명 어느 쪽에든 걸리면 통과. 빈 쿼리는 전부 통과. */
export function filterItems<T extends SlashItem>(items: readonly T[], query: string): T[] {
  const q = normalize(query)
  if (q === '') return [...items]
  return items.filter(
    (item) => normalize(item.display).includes(q) || normalize(item.description).includes(q),
  )
}
