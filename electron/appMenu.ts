import { Menu } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'

// 애플리케이션 메뉴 — 기본 메뉴에서 **가속기가 renderer 를 가리는 항목을 뺀** 구성.
//
// 메뉴를 안 세우면 Electron 기본 메뉴가 붙고, 그 안의 close role 이 ⌘W 를
// renderer 보다 먼저 가로채 "탭 닫기" 단축키가 영영 도달하지 못한다 (실측).
// 편집 role(복사/붙여넣기/잘라내기)은 반드시 보존 — 특히 macOS 는 이 role 이
// 없으면 입력창 복붙이 통째로 죽는다.
//
// **undo/redo 도 같은 함정이다 (2026-08-18).** `editMenu` 는 ⌘Z·⇧⌘Z 를 달고 오는데,
// 그 role 은 Chromium 의 **네이티브 편집 undo** 를 부른다. 편집기는 CodeMirror 이고
// 자기 이력을 따로 쥐므로(`CodeEditor.tsx` 의 `history()`·`historyKeymap`) 그 호출은
// 아무 일도 안 한다 — 그리고 키는 메뉴가 먹어서 CodeMirror 까지 **가지 않는다.**
// 그래서 편집기에서 ⌘Z 가 죽은 키였다.
//
// 고침은 편집 메뉴를 직접 짜고 **undo/redo 만 빼는 것**이다. 복붙 role 은 그대로 남아
// macOS 요건을 지키고, ⌘Z 는 아무도 안 잡으므로 renderer 까지 내려간다.
// 입력창(`textarea`)의 되돌리기는 Chromium 이 자체 처리한다 — 메뉴 항목이 필요 없다.

/**
 * 플랫폼별 메뉴 템플릿. 순수 함수 — 테스트가 close role 부재와 undo 가속기 부재를 잠근다.
 */
export function buildAppMenuTemplate(platform: NodeJS.Platform): MenuItemConstructorOptions[] {
  return [
    // macOS 관례의 앱 메뉴 (About/Hide/Quit). 다른 플랫폼은 파일 메뉴에 종료만 남긴다.
    ...(platform === 'darwin'
      ? [{ role: 'appMenu' as const }]
      : [{ label: '파일', submenu: [{ role: 'quit' as const }] }]),
    { label: '편집', submenu: editSubmenu(platform) },
    { role: 'viewMenu' },
    // windowMenu 는 Minimize/Zoom 등만 담는다 — close 는 fileMenu 쪽 role 이라 여기 없다
    { role: 'windowMenu' },
  ]
}

/** `editMenu` role 에서 undo/redo 만 뺀 것. 나머지는 role 그대로라 네이티브가 처리한다. */
function editSubmenu(platform: NodeJS.Platform): MenuItemConstructorOptions[] {
  return [
    { role: 'cut' },
    { role: 'copy' },
    { role: 'paste' },
    ...(platform === 'darwin' ? ([{ role: 'pasteAndMatchStyle' }] as MenuItemConstructorOptions[]) : []),
    { role: 'delete' },
    { type: 'separator' },
    { role: 'selectAll' },
  ]
}

export function installAppMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildAppMenuTemplate(process.platform)))
}
