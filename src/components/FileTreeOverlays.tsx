import { FileTreeMenu } from './FileTreeMenu'
import { FileTreePrompt } from './FileTreePrompt'
import type { FileTreeActionsApi } from '../state/useFileTreeActions'

// 파일 트리 위에 뜨는 것 둘 — 우클릭 메뉴와 이름 묻는 창.
//
// `ProjectSidebar` 에서 갈라냈다: 저쪽이 300줄 상한에 닿았고, 이 둘은 **사이드바의 내용이
// 아니라 그 위에 뜨는 층**이라 자리가 어색하지도 않다.
//
// **트리 안에 그리지 않는다.** 트리는 스크롤 칸이라 그 안에 두면 잘린다. 둘 다
// `position: fixed`(메뉴) 와 모달(창)이라 어느 층에 있어도 좌표대로 뜬다.

export function FileTreeOverlays({ files }: { files: FileTreeActionsApi }) {
  return (
    <>
      {files.menu !== null && (
        <FileTreeMenu
          x={files.menu.x}
          y={files.menu.y}
          isDirectory={files.menu.isDirectory}
          onPick={files.pick}
          onDismiss={files.closeMenu}
        />
      )}
      {files.prompt !== null && (
        <FileTreePrompt
          title={files.prompt.title}
          hint={files.prompt.hint}
          value={files.prompt.value}
          onDone={files.submit}
        />
      )}
    </>
  )
}
