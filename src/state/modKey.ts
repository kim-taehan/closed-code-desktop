// 수식키 표기 한 곳.
//
// ⚙ 메뉴(AppMenu)와 설정의 단축키 목록(ShortcutsSection)이 **같은 판정**을 쓴다.
// 판정을 양쪽에 복사하면 언젠가 갈린다 — 메뉴는 `⌘L`, 목록은 `Ctrl + L` 로 보이는 날이 온다.

// macOS 는 ⌘ 등 기호로, Windows/Linux 는 Ctrl 등 낱말로 — 각 OS 사용자에게 익숙한 표기.
const IS_MAC = navigator.platform.toLowerCase().includes('mac')
export const MOD = IS_MAC ? '⌘' : 'Ctrl'

// mac 에서만 낱말을 기호로 바꾼다 (Windows 는 낱말 그대로).
const MAC_SYMBOLS: Record<string, string> = { Shift: '⇧', Enter: '⏎', Esc: '⎋', Tab: '⇥', Alt: '⌥' }

/** 목록에 쓰는 긴 표기 — `⌘ + Shift + F` 처럼 낱말을 그대로 두고 mac 만 기호로 바꾼다. */
export function fmtKeys(keys: string): string {
  return IS_MAC ? keys.replace(/\b(Shift|Enter|Esc|Tab|Alt)\b/g, (token) => MAC_SYMBOLS[token] ?? token) : keys
}

/**
 * 메뉴 오른쪽에 붙는 짧은 표기 — mac 은 `⌘L`, 그 밖은 `Ctrl+L`.
 *
 * mac 기호는 붙여 쓰는 것이 관례지만 낱말은 붙이면 `CtrlL` 이 되므로 `+` 를 끼운다.
 */
export function accel(key: string): string {
  return IS_MAC ? `${MOD}${key}` : `${MOD}+${key}`
}
