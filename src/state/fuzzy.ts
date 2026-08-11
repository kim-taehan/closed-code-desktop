/**
 * 빠른 열기용 퍼지 검색 (desktop2 에서 가져왔다 — 순수 함수라 다시 만들 이유가 없다).
 *
 * Subsequence fuzzy match with light scoring, for quick-open file search.
 *
 * `query` matches `target` if its chars appear in order (not necessarily
 * adjacent). Score rewards consecutive runs, matches at path/word boundaries,
 * and matches inside the basename — so `apps` ranks `App.tsx` above a deep path
 * that merely contains a-p-p-s scattered. Returns matched indices for highlight,
 * or null when there is no subsequence match.
 */
export interface FuzzyResult {
  score: number
  positions: number[]
}

const BOUNDARY = /[/_\-. ]/

export function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  if (!query) return { score: 0, positions: [] }
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  const positions: number[] = []
  const basenameStart = target.lastIndexOf('/') + 1

  let ti = 0
  let prev = -2
  let score = 0
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]!
    let found = -1
    for (; ti < t.length; ti++) {
      if (t[ti] === ch) {
        found = ti
        break
      }
    }
    if (found === -1) return null

    let s = 1
    if (found === prev + 1) s += 5 // consecutive run
    const before = found > 0 ? target[found - 1]! : '/'
    if (BOUNDARY.test(before)) s += 8 // right after a separator
    else if (isLower(before) && isUpper(target[found]!)) s += 6 // camelCase boundary
    if (found >= basenameStart) s += 3 // in the basename, not a parent dir

    score += s
    positions.push(found)
    prev = found
    ti = found + 1
  }

  // Tie-breakers: prefer shorter paths and an earlier first hit.
  score -= target.length * 0.05
  score -= (positions[0] ?? 0) * 0.1
  return { score, positions }
}

function isLower(c: string): boolean {
  return c >= 'a' && c <= 'z'
}
function isUpper(c: string): boolean {
  return c >= 'A' && c <= 'Z'
}
