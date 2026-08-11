import { Menu } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'

// 애플리케이션 메뉴 — 기본 메뉴에서 **Close Window(⌘/Ctrl+W)만 뺀** 구성.
//
// 메뉴를 안 세우면 Electron 기본 메뉴가 붙고, 그 안의 close role 이 ⌘W 를
// renderer 보다 먼저 가로채 "탭 닫기" 단축키가 영영 도달하지 못한다 (실측).
// 편집 role(복사/붙여넣기/잘라내기)은 반드시 보존 — 특히 macOS 는 이 role 이
// 없으면 입력창 복붙이 통째로 죽는다.

/** 플랫폼별 메뉴 템플릿. 순수 함수 — 테스트가 close role 부재를 잠근다. */
export function buildAppMenuTemplate(platform: NodeJS.Platform): MenuItemConstructorOptions[] {
  return [
    // macOS 관례의 앱 메뉴 (About/Hide/Quit). 다른 플랫폼은 파일 메뉴에 종료만 남긴다.
    ...(platform === 'darwin'
      ? [{ role: 'appMenu' as const }]
      : [{ label: '파일', submenu: [{ role: 'quit' as const }] }]),
    { role: 'editMenu' },
    { role: 'viewMenu' },
    // windowMenu 는 Minimize/Zoom 등만 담는다 — close 는 fileMenu 쪽 role 이라 여기 없다
    { role: 'windowMenu' },
  ]
}

export function installAppMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildAppMenuTemplate(process.platform)))
}
