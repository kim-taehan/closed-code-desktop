import { FileTreeMenu } from './FileTreeMenu'
import { FileTreePrompt } from './FileTreePrompt'
import { fileCommands } from '../state/extensionCommandSlots'
import type { FileTreeActionsApi } from '../state/useFileTreeActions'
import type { ExtensionPanelHandle } from '../state/useExtensionPanel'

// 파일 트리 위에 뜨는 것 둘 — 우클릭 메뉴와 이름 묻는 창.
//
// `ProjectSidebar` 에서 갈라냈다: 저쪽이 300줄 상한에 닿았고, 이 둘은 **사이드바의 내용이
// 아니라 그 위에 뜨는 층**이라 자리가 어색하지도 않다.
//
// **트리 안에 그리지 않는다.** 트리는 스크롤 칸이라 그 안에 두면 잘린다. 둘 다
// `position: fixed`(메뉴) 와 모달(창)이라 어느 층에 있어도 좌표대로 뜬다.

// 확장 항목을 **여기서** 걷는다 — `ProjectSidebar` 는 300줄 상한에 붙어 있고, 이 값은
// 메뉴에만 쓰인다. 사이드바는 확장 api 를 넘겨주기만 한다.

export function FileTreeOverlays({
  files,
  extensions,
}: {
  files: FileTreeActionsApi
  extensions: ExtensionPanelHandle
}) {
  const menuPath = files.menu?.path ?? ''
  const extras = fileCommands(extensions.extensions).map((one) => ({
    extension: one.extension,
    id: one.command.id,
    title: one.command.title,
  }))

  return (
    <>
      {files.menu !== null && (
        <FileTreeMenu
          x={files.menu.x}
          y={files.menu.y}
          isDirectory={files.menu.isDirectory}
          onPick={files.pick}
          extras={extras}
          // 대상 경로를 **고른 것**으로 실어 보낸다 (`runCommand` 의 두 번째 인자).
          // 화면 다리(`data-arg`)는 문자열 하나를 보내는데 이쪽은 배열이라, 받는 확장이
          // 두 모양을 다 견뎌야 한다 — 그 사실을 확장 쪽에 적어 뒀다
          onRunExtra={(extra) => void extensions.runCommand(extra.id, [menuPath])}
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
