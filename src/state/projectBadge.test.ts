import { describe, expect, it } from 'vitest'
import { projectBadge, projectBadges, projectHue, projectInitials } from './projectBadge'

// 레일 칩의 머리글자와 색.
//
// 이 규칙을 고른 이유가 시험 하나에 걸려 있다 — **앞 글자가 겹치는 이름을 갈라야 한다.**
// 실제로 열어 두는 프로젝트가 `davis-backend-tobe` · `davis-code-desktop` 이라
// 앞 두 글자(`da`)로는 구분이 안 된다.

describe('머리글자', () => {
  it('마디가 여럿이면 각 마디의 첫 글자를 쓴다 — 앞이 겹쳐도 갈린다', () => {
    expect(projectInitials('davis-backend-tobe')).toBe('DB')
    expect(projectInitials('davis-code-desktop')).toBe('DC')
  })

  it('마디가 하나면 앞 두 글자', () => {
    expect(projectInitials('docs')).toBe('DO')
  })

  it('밑줄·점·공백도 마디로 본다', () => {
    expect(projectInitials('my_project')).toBe('MP')
    expect(projectInitials('a.b')).toBe('AB')
    expect(projectInitials('내 프로젝트')).toBe('내프')
  })

  it('한글은 대문자 변환이 없어 그대로 남는다', () => {
    expect(projectInitials('사내포털')).toBe('사내')
  })

  it('한 글자짜리 이름도 버틴다', () => {
    expect(projectInitials('x')).toBe('X')
  })

  // 이름이 비거나 구분자뿐이면 칩이 빈칸이 된다 — 뭐라도 그려야 누를 수 있다
  it('쓸 글자가 없으면 물음표', () => {
    expect(projectInitials('')).toBe('?')
    expect(projectInitials('---')).toBe('?')
  })

  it('이모지가 반토막 나지 않는다', () => {
    expect(projectInitials('🚀-launch')).toBe('🚀L')
  })
})

describe('색', () => {
  // 켤 때마다 다시 뽑으면 어제 파란색이던 것이 오늘 초록색이 된다 — 색이 표식이 못 된다
  it('같은 이름은 늘 같은 색', () => {
    expect(projectHue('docs')).toBe(projectHue('docs'))
    expect(projectBadge('docs').color).toBe(projectBadge('docs').color)
  })

  it('한 글자만 달라도 색이 벌어진다', () => {
    expect(projectBadge('davis-backend-tobe').color).not.toBe(
      projectBadge('davis-code-desktop').color,
    )
  })

  it('색상각은 0~359 안에 있다', () => {
    for (const name of ['a', 'docs', 'davis-code-desktop', '사내포털', '🚀']) {
      const hue = projectHue(name)
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(360)
    }
  })

  // 배경은 같은 색의 옅은 알파다 — 테마 배경 위에 그대로 얹혀야 한다
  it('글자색과 배경이 같은 색조를 쓴다', () => {
    const badge = projectBadge('docs')
    const hue = badge.color.match(/hsl\((\d+)/)![1]
    expect(badge.background).toBe(`hsl(${hue} 55% 42% / 0.14)`)
  })

  // 해시각을 그대로 쓰면 44도·42도처럼 2도 차이가 난다 — 눈으로 같은 색이다
  it('색은 30도씩 벌린 칸에서만 나온다', () => {
    for (const name of ['a', 'docs', 'davis-code-desktop', '사내포털']) {
      const hue = Number(projectBadge(name).color.match(/hsl\((\d+)/)![1])
      expect(hue % 30).toBe(0)
    }
  })
})

describe('나란히 열린 것끼리는 색이 겹치지 않는다', () => {
  // 실측에서 나온 것: 이 둘은 해시각이 44도·42도라 같은 칸에 떨어진다
  it('같은 칸에 떨어지면 빈 칸으로 밀어낸다', () => {
    const badges = projectBadges(['davis-backend-tobe', 'docs'])

    expect(badges.get('davis-backend-tobe')!.color).not.toBe(badges.get('docs')!.color)
  })

  it('열두 개까지는 전부 다른 색', () => {
    const names = Array.from({ length: 12 }, (_, i) => `프로젝트-${i}`)
    const colors = new Set([...projectBadges(names).values()].map((badge) => badge.color))

    expect(colors.size).toBe(12)
  })

  // 칸보다 많으면 겹칠 수밖에 없다. 그때는 머리글자가 갈라 준다 — 멈추지만 않으면 된다
  it('칸보다 많아도 전부 색을 받는다', () => {
    const names = Array.from({ length: 20 }, (_, i) => `프로젝트-${i}`)
    const badges = projectBadges(names)

    expect(badges.size).toBe(20)
    for (const name of names) expect(badges.get(name)!.color).toMatch(/^hsl\(/)
  })

  it('목록이 그대로면 결과도 그대로다', () => {
    const names = ['davis-backend-tobe', 'docs', 'davis-code-desktop']
    const first = projectBadges(names)
    const again = projectBadges(names)

    for (const name of names) expect(again.get(name)!.color).toBe(first.get(name)!.color)
  })

  it('같은 이름이 두 번 와도 한 번만 센다', () => {
    expect(projectBadges(['docs', 'docs']).size).toBe(1)
  })
})
