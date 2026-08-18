import { describe, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { buildAppMenuTemplate } from './appMenu'

// 앱 메뉴 템플릿. close role 이 다시 들어오면 ⌘W 가 renderer 에 닿기 전에
// 창을 닫아버린다 — 그 회귀를 여기서 잠근다.

// 템플릿 빌더는 순수지만 모듈이 electron 을 import 한다 — Menu 만 스텁한다 (vi.mock 은 호이스팅된다)
vi.mock('electron', () => ({ Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn() } }))

/** 템플릿 전체(하위 메뉴 포함)의 role 을 평탄하게 모은다 */
function rolesOf(template: MenuItemConstructorOptions[]): string[] {
  return template.flatMap((entry) => [
    ...(entry.role ? [String(entry.role)] : []),
    ...(Array.isArray(entry.submenu)
      ? entry.submenu.flatMap((item) => (item.role ? [String(item.role)] : []))
      : []),
  ])
}

describe('buildAppMenuTemplate', () => {
  it('close role 이 없다 — ⌘/Ctrl+W 가 renderer 의 탭 닫기에 닿아야 한다', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      expect(rolesOf(buildAppMenuTemplate(platform))).not.toContain('close')
      expect(rolesOf(buildAppMenuTemplate(platform))).not.toContain('fileMenu')
    }
  })

  it('복붙 role 은 모든 플랫폼에 있다 — 없으면 입력창 복붙이 죽는다', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const roles = rolesOf(buildAppMenuTemplate(platform))
      for (const role of ['cut', 'copy', 'paste', 'selectAll']) expect(roles).toContain(role)
    }
  })

  // undo/redo role 은 Chromium 의 **네이티브** 편집 undo 를 부른다. 편집기는 CodeMirror 라
  // 자기 이력을 따로 쥐므로 그 호출은 아무 일도 안 하고, 키는 메뉴가 먹어서 CodeMirror 까지
  // 가지도 않는다 — ⌘Z 가 죽은 키가 된다. 그래서 `editMenu` 를 통째로 쓰지 않는다.
  it('undo·redo role 이 없다 — ⌘Z 가 CodeMirror 까지 내려가야 한다', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const roles = rolesOf(buildAppMenuTemplate(platform))
      expect(roles).not.toContain('undo')
      expect(roles).not.toContain('redo')
      // `editMenu` 를 그대로 쓰면 undo/redo 가 딸려 온다 — role 이름만 봐서는 안 보이므로 함께 잠근다
      expect(roles).not.toContain('editMenu')
    }
  })

  it('macOS 는 앱 메뉴, 그 외에는 종료가 있는 파일 메뉴', () => {
    expect(rolesOf(buildAppMenuTemplate('darwin'))).toContain('appMenu')
    expect(rolesOf(buildAppMenuTemplate('win32'))).toContain('quit')
  })
})
