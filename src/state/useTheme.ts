import { useCallback, useEffect, useState } from 'react'

// 테마 선택. 고른 값은 localStorage 에 남겨 다음 실행에도 유지한다.
//
// 팔레트는 desktop2 에서 가져왔다 (순수 자산이라 다시 만들 이유가 없다).
// **운영체제를 따라가는 '시스템' 은 두지 않는다** — 고른 대로만 보인다.

/** 순서가 곧 설정 화면의 순서다 — 많이 쓰는 것부터. */
export const THEMES = ['dark', 'paper', 'ivory', 'dracula', 'graphite', 'nord', 'slate', 'solarized'] as const

export type Theme = (typeof THEMES)[number]
export type ThemeChoice = Theme

const DEFAULT_THEME: Theme = 'dark'

/** 라이트 계열 */
const LIGHT_THEMES = new Set<Theme>(['paper', 'ivory', 'slate'])

const STORAGE_KEY = 'davis.theme'

export interface ThemeState {
  choice: ThemeChoice
  setChoice: (choice: ThemeChoice) => void
}

export function useTheme(): ThemeState {
  const [choice, setChoiceState] = useState<ThemeChoice>(readStored)

  // CSS 는 data-theme 속성으로 분기한다
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', choice)
  }, [choice])

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // 저장에 실패해도 이번 세션은 정상 동작한다
    }
  }, [])

  return { choice, setChoice }
}

export function isLight(theme: Theme): boolean {
  return LIGHT_THEMES.has(theme)
}

/**
 * 견본에 쓸 대표 색. CSS 팔레트에서 뽑은 값이라 **바꿀 때 함께 고쳐야 한다** —
 * 어긋나면 themeSwatch.test.ts 가 잡는다.
 */
export const THEME_SWATCH: Record<Theme, { bg: string; fg: string; accent: string }> = {
  dark: { bg: '#0d1117', fg: '#e6edf3', accent: '#79c0ff' },
  paper: { bg: '#ffffff', fg: '#1f2328', accent: '#0969da' },
  ivory: { bg: '#faf8f3', fg: '#322f28', accent: '#217f74' },
  dracula: { bg: '#282a36', fg: '#f8f8f2', accent: '#bd93f9' },
  graphite: { bg: '#202225', fg: '#e8eaed', accent: '#8fb0cc' },
  nord: { bg: '#2e3440', fg: '#d8dee9', accent: '#88c0d0' },
  slate: { bg: '#f1f3f5', fg: '#2c353d', accent: '#456b93' },
  solarized: { bg: '#002b36', fg: '#839496', accent: '#268bd2' },
}

/** 한 줄 설명. 이름만으로는 무엇이 다른지 알 수 없다. */
export const THEME_DESC: Record<ThemeChoice, string> = {
  dark: 'GitHub 다크 계열. 기본값',
  paper: '순백 배경. 밝은 곳에서 또렷합니다',
  ivory: '따뜻한 아이보리 + 틸 강조. 눈 피로가 적습니다',
  dracula: '보라 강조의 개성파 다크',
  graphite: '채도를 누른 차분한 그레이 톤 다크',
  nord: '북유럽풍 블루그레이 다크 (Nord)',
  slate: '쿨 그레이 라이트. 그라파이트의 밝은 짝',
  solarized: '청록 배경의 고전 솔라라이즈드 다크',
}

export const THEME_LABEL: Record<ThemeChoice, string> = {
  dark: '다크',
  paper: '페이퍼 화이트',
  ivory: '웜 아이보리',
  dracula: '드라큘라',
  graphite: '그라파이트',
  nord: '노르드',
  slate: '슬레이트',
  solarized: '솔라라이즈드 다크',
}

function readStored(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored !== null && (THEMES as readonly string[]).includes(stored)) return stored as Theme
    // 없어진 값을 이관한다: light → paper, system/midnight → 기본값
    if (stored === 'light') return 'paper'
  } catch {
    // localStorage 를 못 쓰는 환경이면 기본값을 쓴다
  }
  return DEFAULT_THEME
}
