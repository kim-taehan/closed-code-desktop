import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { THEMES, THEME_SWATCH } from './useTheme'

// 견본 색은 CSS 팔레트를 손으로 옮겨 적은 값이다.
// 두 곳에 따로 있으니 한쪽만 고치면 조용히 어긋난다 — 그걸 여기서 잡는다.
//
// (CSS 변수를 그대로 읽어 쓰려면 그 테마를 실제로 적용해야만 값을 알 수 있어,
//  고르기 전에 보여줄 수가 없다. 그래서 옮겨 적되 대조로 지킨다.)

const css = readFileSync(join(__dirname, '../styles/chat.css'), 'utf8')

/** 해당 테마 블록에서 배경·글자·강조를 뽑는다. dark 는 :root 기본값이다. */
function paletteOf(theme: string): Record<string, string> {
  const pattern =
    theme === 'dark'
      ? /:root\s*\{([\s\S]*?)\n\}/
      : new RegExp(`:root\\[data-theme='${theme}'\\]\\s*\\{([\\s\\S]*?)\\n\\}`)

  const block = css.match(pattern)
  expect(block, `${theme} 팔레트를 CSS 에서 찾지 못했습니다`).toBeTruthy()

  const found: Record<string, string> = {}
  for (const [, key, value] of block![1]!.matchAll(/--dc-(bg|text|accent):\s*([^;]+);/g)) {
    found[key!] = value!.trim().toLowerCase()
  }
  return found
}

describe('테마 견본', () => {
  it.each(THEMES)('%s 견본이 CSS 팔레트와 같다', (theme) => {
    const palette = paletteOf(theme)
    const swatch = THEME_SWATCH[theme]

    expect(swatch.bg.toLowerCase()).toBe(palette['bg'])
    expect(swatch.fg.toLowerCase()).toBe(palette['text'])
    expect(swatch.accent.toLowerCase()).toBe(palette['accent'])
  })

  it('없어진 테마의 팔레트가 CSS 에 남아 있지 않다', () => {
    expect(css).not.toContain("data-theme='midnight'")
  })
})
