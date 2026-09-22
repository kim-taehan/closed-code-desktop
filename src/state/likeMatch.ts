// 빠른 열기의 **like 검색** — `*` 는 0자 이상 아무 문자, `?` 는 정확히 한 자.
// (davis-code-desktop `0d2bc59` 에서 그대로 가져왔다.)
//
// 퍼지 검색(`fuzzy.ts`)은 글자를 순서대로 찾는 부분수열이라 `*` 를 **글자 그대로** 찾는다.
// `*.controller` 를 치면 "맞는 파일이 없습니다" 가 뜬다. 그래서 **와일드카드가 있을 때만**
// 이쪽으로 온다 — 없으면 종전 퍼지가 그대로다 (짧은 약어로 찾는 주 경로다: `apps` → `App.tsx`).
//
// 판정 세 가지를 근거와 함께 적어 둔다.
//
// 1) **파일명 기준.** 쿼리에 `/` 가 없으면 basename 하고만 맞춘다. 경로 전체와 맞추면
//    `*` 가 `/` 를 넘어 `src/*` 하나가 저장소 전부를 잡는다. `/` 를 쓴 쿼리는 경로와 맞추되
//    그때도 `*`·`?` 는 `/` 를 넘지 않는다 (glob 관례).
// 2) **양끝을 묶지 않는다(contains).** `*.controller` 가 `user.controller.ts` 를 잡아야 하는데
//    끝을 묶으면 뒤의 `.ts` 때문에 떨어진다.
// 3) **`.` 은 이름 구분점이다** — 점·밑줄·하이픈·공백, 그리고 camelCase 경계에도 맞는다.
//    `*.controller` 가 `FooController.java` 를 잡아야 한다는 요구가 이 규칙의 근거다
//    (`FooController` 에는 점이 없다 — 있는 것은 소문자→대문자 경계뿐이다).
//    구분점 개념은 새로 만든 것이 아니라 퍼지 쪽 `BOUNDARY`(`fuzzy.ts:17`)와 같은 것이다.

/** `.` 하나가 맞는 것: 구분 문자 하나, 또는 camelCase 경계(폭 0) */
const SEPARATOR = '(?:[._\\-\\s]|(?<=[a-z0-9])(?=[A-Z]))'

const SPECIAL = /[\\^$.*+?()[\]{}|]/

/** 이 쿼리를 like 로 볼 것인가. 아니면 부르는 쪽이 퍼지로 간다. */
export function hasWildcard(query: string): boolean {
  return query.includes('*') || query.includes('?')
}

/**
 * 맞으면 정렬용 점수, 아니면 null.
 *
 * 점수는 순위를 가르는 데만 쓴다 — like 는 맞고 안 맞고가 전부라 가중치를 둘 자리가 없다.
 * 같은 값끼리는 짧은 경로가 앞선다 (퍼지 쪽 tie-breaker 와 같은 규칙).
 */
export function likeMatch(query: string, target: string): number | null {
  const pattern = compile(query)
  if (pattern === null) return null

  const subject = query.includes('/') ? target : target.slice(target.lastIndexOf('/') + 1)
  if (!pattern.test(subject)) return null
  return -target.length * 0.05
}

// 같은 쿼리로 파일 수(최대 2만)만큼 불린다 — 그때마다 정규식을 새로 짜지 않는다.
// `g` 플래그가 없으므로 다시 써도 상태가 남지 않는다.
let cached: { query: string; pattern: RegExp | null } | null = null

function compile(query: string): RegExp | null {
  if (cached === null || cached.query !== query) cached = { query, pattern: build(query) }
  return cached.pattern
}

function build(query: string): RegExp | null {
  let source = ''
  for (const ch of query) {
    if (ch === '*') source += '[^/]*'
    else if (ch === '?') source += '[^/]'
    else if (ch === '.') source += SEPARATOR
    else source += literal(ch)
  }

  try {
    return new RegExp(source)
  } catch {
    // 아래 `literal` 이 전부 이스케이프하므로 여기 올 일은 없는 것이 정상이다.
    // 그래도 던지면 팝업이 통째로 죽으므로 "맞는 것 없음" 으로 떨어뜨린다.
    return null
  }
}

/**
 * 글자 하나를 정규식으로. **`i` 플래그를 쓰지 않는다** — 쓰면 위 `SEPARATOR` 의
 * `(?<=[a-z0-9])(?=[A-Z])` 까지 대소문자를 무시해 camelCase 경계가 아무 데나 맞는다.
 * 대소문자 무시는 글자마다 `[aA]` 로 직접 편다.
 */
function literal(ch: string): string {
  const lower = ch.toLowerCase()
  const upper = ch.toUpperCase()
  // 대소문자가 갈리는 것은 글자뿐이라 문자군 안에서 따로 이스케이프할 것이 없다
  if (lower !== upper) return `[${lower}${upper}]`
  return SPECIAL.test(ch) ? `\\${ch}` : ch
}
