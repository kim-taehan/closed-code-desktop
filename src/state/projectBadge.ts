// 프로젝트 레일 칩에 그릴 것 — 머리글자와 색.
//
// **색은 이름에서 뽑는다. 진짜 난수가 아니다.** 켤 때마다 다시 뽑으면 어제 파란색이던
// 프로젝트가 오늘 초록색이 되어, 색으로 알아보는 것 자체가 불가능해진다.
// 같은 이름 → 늘 같은 색이어야 색이 표식 노릇을 한다.
//
// 색을 **HSL 한 축(색상)만** 바꾼다. 채도·명도를 고정하면 어느 테마에서도 읽히는 톤이
// 유지된다 — 배경은 같은 색의 옅은 알파라 테마 배경 위에 그대로 얹히고,
// 글자는 중간 명도라 흰 바탕(paper)에서도 어두운 바탕(dark)에서도 버틴다.

/** 이름을 쪼개는 구분자. `davis-backend-tobe` · `my_project` · `a.b` · `내 프로젝트` */
const SEPARATOR = /[-_.\s]+/

/**
 * 레일 칩에 적을 두 글자.
 *
 * 마디가 둘 이상이면 **각 마디의 첫 글자**를 쓴다 — `davis-backend-tobe` 와
 * `davis-code-desktop` 은 앞 두 글자(`da`)가 같아 구분이 안 되지만,
 * 머리글자 조합(`db`·`dc`)은 갈린다. 그게 이 규칙을 고른 이유다.
 *
 * 마디가 하나면 앞 두 글자를 쓴다 (`docs` → `DO`).
 *
 * 대문자로 만든다 — 30px 칩에서 소문자는 x-height 가 낮아 눈에 덜 걸린다.
 * 한글·숫자는 대문자 변환이 없어 그대로 남는다.
 */
export function projectInitials(name: string): string {
  const parts = name.split(SEPARATOR).filter((part) => part !== '')
  if (parts.length === 0) return '?'

  const letters =
    parts.length >= 2
      ? `${firstChar(parts[0]!)}${firstChar(parts[1]!)}`
      : [...parts[0]!].slice(0, 2).join('')

  return letters.toUpperCase()
}

/** 서로게이트 쌍(이모지 등)이 반토막 나지 않게 코드포인트로 자른다. */
function firstChar(part: string): string {
  return [...part][0] ?? ''
}

/**
 * 이름 → 색상각(0~359).
 *
 * FNV-1a 32비트. 암호용이 아니라 **흩뿌리기용**이라 이걸로 충분하고, 짧아서
 * 새 의존성이 필요 없다 (에어갭). 한 글자만 달라도 값이 크게 벌어진다.
 */
export function projectHue(name: string): number {
  let hash = 0x811c9dc5
  for (const char of name) {
    hash ^= char.codePointAt(0) ?? 0
    // FNV 소수 곱셈. `Math.imul` 로 32비트 안에서 돌린다
    hash = Math.imul(hash, 0x01000193)
  }
  return Math.abs(hash) % 360
}

export interface ProjectBadge {
  initials: string
  /** 칩 글자·테두리 */
  color: string
  /** 칩 배경. 같은 색의 옅은 알파라 어느 테마 배경 위에도 얹힌다 */
  background: string
}

/**
 * 쓸 수 있는 색 칸. 30도씩 벌려 둔다 — **옆칸끼리 눈으로 갈려야** 색이 표식이 된다.
 *
 * 해시값(0~359)을 그대로 쓰지 않는 이유가 실측에서 나왔다: `davis-backend-tobe` 는 44도,
 * `docs` 는 42도로 **2도 차이**였다. 해시는 흩뿌릴 뿐 최소 간격을 보장하지 않는다.
 */
const SLOTS = 12
const SLOT_DEGREES = 360 / SLOTS

function slotColor(slot: number): Pick<ProjectBadge, 'color' | 'background'> {
  const hue = Math.round(slot * SLOT_DEGREES)
  return {
    color: `hsl(${hue} 55% 42%)`,
    background: `hsl(${hue} 55% 42% / 0.14)`,
  }
}

/** 이름 하나만 볼 때. 열려 있는 것들 사이의 충돌은 `projectBadges` 가 푼다. */
export function projectBadge(name: string): ProjectBadge {
  return {
    initials: projectInitials(name),
    ...slotColor(projectHue(name) % SLOTS),
  }
}

/**
 * 열려 있는 프로젝트들의 칩을 한꺼번에 정한다.
 *
 * **같은 칸에 떨어지면 빈 칸으로 밀어낸다.** 색을 이름 해시로만 정하면 지금 화면에
 * 나란히 있는 둘이 같은 색이 될 수 있는데, 그러면 색이 표식 노릇을 못 한다.
 *
 * 그 대가: **열린 목록이 바뀌면 밀려난 쪽의 색이 바뀔 수 있다.** 이름만 보고 정하는 것이
 * 아니라 "지금 누구와 함께 열려 있나" 가 섞이기 때문이다. 늘 같은 색인 편과, 화면에서
 * 늘 갈리는 편 중 후자를 골랐다 — 색을 쓰는 목적이 구분이라서다.
 *
 * 앞에 오는 것이 자기 칸을 먼저 가진다. 목록 순서가 그대로면 결과도 그대로다.
 */
export function projectBadges(names: readonly string[]): Map<string, ProjectBadge> {
  const taken = new Set<number>()
  const badges = new Map<string, ProjectBadge>()

  for (const name of names) {
    if (badges.has(name)) continue

    const wanted = projectHue(name) % SLOTS
    let slot = wanted
    // 빈 칸을 찾아 한 칸씩 옮긴다. 다 찼으면 원래 칸으로 돌아와 색이 겹친다 —
    // 칸보다 프로젝트가 많으면 어차피 겹칠 수밖에 없고, 그때는 머리글자가 갈라 준다
    for (let step = 0; step < SLOTS && taken.has(slot); step += 1) {
      slot = (wanted + step + 1) % SLOTS
    }
    taken.add(slot)

    badges.set(name, { initials: projectInitials(name), ...slotColor(slot) })
  }

  return badges
}
