import { useCallback, useState } from 'react'
import type { ProjectFsAction, ProjectFsResult } from '../../shared/ipc/projectFsPayloads'
import type { FileTreeMenuPick } from '../components/FileTreeMenu'

// 파일 트리 우클릭 메뉴의 **배선** — 메뉴를 어디 띄우고, 무엇을 묻고, 끝나면 어디를 다시 읽나.
//
// `ProjectSidebar` 에서 갈라냈다: 저쪽이 300줄 상한에 붙어 있고, 여기 있는 것은 그리기가
// 아니라 상태 기계다. 그리는 것 둘(`FileTreeMenu`·`FileTreePrompt`)은 이 훅이 내주는
// 값으로 부르는 쪽이 그린다.
//
// **확인 창을 두지 않는다.** 「휴지통으로」는 OS 휴지통으로 가므로 되돌릴 수 있고,
// 되돌릴 수 있는 조작에 확인을 붙이면 사람이 확인을 안 읽게 된다 — 정말 물어야 할 때
// 그 습관이 남는다.

/** 지금 열려 있는 메뉴. 대상과 화면 좌표를 함께 든다 */
export interface TreeMenuState {
  path: string
  isDirectory: boolean
  x: number
  y: number
}

/** 이름을 묻는 중. `kind` 가 무엇을 만들지·바꿀지를 가른다 */
export interface TreePromptState {
  kind: 'newFile' | 'newDir' | 'rename'
  /** 우클릭한 줄 */
  path: string
  /** 만들 자리(부모 폴더). 프로젝트 루트 기준이고 루트면 빈 문자열 */
  dir: string
  title: string
  hint: string
  value: string
}

/** 실패 사유 → 사람 말. **코드값을 그대로 보여주지 않는다** (이 레포 관례) */
const REASON: Record<string, string> = {
  not_allowed: '이 프로젝트 밖은 건드릴 수 없습니다',
  exists: '같은 이름이 이미 있습니다',
  missing: '그 파일이 없습니다 — 목록을 다시 읽어 보세요',
  failed: '하지 못했습니다',
}

export interface FileTreeActionsApi {
  menu: TreeMenuState | null
  prompt: TreePromptState | null
  openMenu: (path: string, isDirectory: boolean, x: number, y: number) => void
  closeMenu: () => void
  /** 메뉴에서 고른 것. 묻는 갈래는 창을 열고, 휴지통은 바로 보낸다 */
  pick: (choice: FileTreeMenuPick) => void
  /** 창의 답. 취소면 `null` */
  submit: (name: string | null) => void
}

export function useFileTreeActions(
  projectId: string | null,
  /** 만들거나 지운 뒤 다시 읽을 자리 (`useFileTree.refresh`) */
  refresh: (dir: string) => void,
  notify: (text: string) => void,
): FileTreeActionsApi {
  const [menu, setMenu] = useState<TreeMenuState | null>(null)
  const [prompt, setPrompt] = useState<TreePromptState | null>(null)

  const run = useCallback(
    async (action: ProjectFsAction, dir: string) => {
      if (projectId === null) return
      // **던지는 것도 받는다** — 부르는 쪽이 `void` 라 놓치면 아무 말 없이 사라진다
      const result: ProjectFsResult = await window.davis
        .fsAction({ projectId, action })
        .catch(() => ({ ok: false as const, reason: 'failed' as const }))

      if (!result.ok) {
        notify(REASON[result.reason] ?? REASON['failed'] ?? '하지 못했습니다')
        return
      }
      // **된 뒤에만 다시 읽는다.** 실패했는데 읽으면 같은 목록이 다시 그려져,
      // 사용자는 「무언가 일어났다」로 읽는다.
      refresh(dir)
    },
    [projectId, refresh, notify],
  )

  const pick = useCallback(
    (choice: FileTreeMenuPick) => {
      if (menu === null) return
      // 폴더 위에서는 그 **안**에, 파일 위에서는 그 파일이 **든 폴더**에 만든다
      const dir = menu.isDirectory ? menu.path : parentOf(menu.path)
      const name = baseName(menu.path)

      if (choice === 'trash') {
        void run({ kind: 'trash', path: menu.path }, parentOf(menu.path))
        return
      }
      if (choice === 'rename') {
        setPrompt({
          kind: 'rename',
          path: menu.path,
          dir: parentOf(menu.path),
          title: '이름 변경',
          hint: menu.path,
          value: name,
        })
        return
      }
      setPrompt({
        kind: choice,
        path: menu.path,
        dir,
        title: choice === 'newFile' ? '새 파일' : '새 폴더',
        hint: dir === '' ? '프로젝트 루트에 만듭니다' : `${dir} 에 만듭니다`,
        value: '',
      })
    },
    [menu, run],
  )

  const submit = useCallback(
    (name: string | null) => {
      const asked = prompt
      setPrompt(null)
      // **취소는 실패가 아니다** — 아무 일도 안 일어난다
      if (asked === null || name === null) return
      // **여기서 다듬는다.** 창이 이미 다듬어 주지만 그것에 기대지 않는다 —
      // 공백만 있는 이름을 그대로 보내면 main 이 경로 전체를 `trim` 하면서
      // `src/lib/   ` 가 **`src/lib` 자신**을 가리킨다 (`resolveNewInside`).
      // 만들려던 것이 부모 폴더를 겨누는 셈이라, 창 밖에서 부르는 길이 생기면 곧바로 샌다.
      const clean = name.trim()
      if (clean === '') return

      const target = asked.dir === '' ? clean : `${asked.dir}/${clean}`
      void run(
        asked.kind === 'rename'
          ? { kind: 'rename', path: asked.path, to: target }
          : { kind: asked.kind, path: target },
        asked.dir,
      )
    },
    [prompt, run],
  )

  return {
    menu,
    prompt,
    openMenu: (path, isDirectory, x, y) => setMenu({ path, isDirectory, x, y }),
    closeMenu: () => setMenu(null),
    pick,
    submit,
  }
}

/** 프로젝트 루트 기준 상대경로의 부모. 루트 바로 밑이면 빈 문자열이다. */
function parentOf(path: string): string {
  const at = path.lastIndexOf('/')
  return at < 0 ? '' : path.slice(0, at)
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}
