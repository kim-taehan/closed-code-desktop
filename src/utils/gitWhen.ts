// git 이 준 시각 문자열을 화면 글자로.
//
// 세 자리(커밋 목록·커밋 상세·브랜치/임시저장 목록)가 같은 규칙을 써야 한다 —
// 같은 저장소가 자리마다 다른 시각을 말하면 안 된다.
//
// **형식이 두 가지로 온다.** 커밋은 `%aI`(엄격 ISO: `2026-07-31T14:20:33+09:00`),
// 브랜치·임시저장은 `%(committerdate:iso8601)`·`%ci`(`2026-07-31 14:20:33 +0900`).
// `Date.parse` 가 둘 다 먹는다.
//
// 상대시각("2시간 전")을 쓰지 않는다 — 지금 시각에 매달리면 같은 화면이 1분 뒤에
// 다른 글자를 내고, 그것을 테스트로 잠그려면 시계를 고정해야 한다.

export function formatGitWhen(iso: string): string {
  const parsed = Date.parse(iso)
  // 못 읽으면 **원문을 그대로** 돌려준다. 빈 칸을 내면 값이 없는 줄로 읽힌다.
  if (!Number.isFinite(parsed)) return iso

  const date = new Date(parsed)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}
