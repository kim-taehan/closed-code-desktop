// 탭 끌어 옮기기의 순서 계산. 프로젝트 칩과 파일 탭이 같이 쓴다.
//
// 끌던 것을 빼고 **놓은 탭의 원래 자리**에 끼운다 — 오른쪽으로 끌면 그 탭 뒤, 왼쪽으로 끌면
// 그 탭 앞에 선다. 커서가 탭의 어느 쪽 절반인지 재지 않아도 맨 앞·맨 뒤까지 모든 자리에 닿는다.

/** `from` 을 `to` 의 자리로 옮긴 새 배열. 둘 중 하나라도 없거나 같으면 원본을 그대로 준다 */
export function moveTo<T>(items: T[], keyOf: (item: T) => string, from: string, to: string): T[] {
  const fromIndex = items.findIndex((item) => keyOf(item) === from)
  const toIndex = items.findIndex((item) => keyOf(item) === to)
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return items
  const next = items.filter((_, index) => index !== fromIndex)
  next.splice(toIndex, 0, items[fromIndex] as T)
  return next
}
