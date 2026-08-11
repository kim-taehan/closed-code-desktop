import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { parseUnifiedDiff, rowsFromContent } from './unifiedDiff'
import { diffTabKey, type ActiveTab, type OpenFile } from './useOpenFiles'

// git diff 를 탭으로 여는 부분. `useOpenFiles` 가 300줄 상한에 닿아 갈라냈다
// (선례: `editorContext.ts`·`recentSaves.ts` 도 같은 이유로 나와 있다).
//
// 탭 목록의 **주인은 여전히 `useOpenFiles`** 다 — 여기는 그쪽 setState 를 받아 쓴다.
// 목록을 두 곳에서 쥐면 어느 쪽이 사실인지 알 수 없다.

export function useOpenDiffTab(
  projectId: string | null,
  setFiles: Dispatch<SetStateAction<OpenFile[]>>,
  setActive: Dispatch<SetStateAction<ActiveTab>>,
): (path: string, staged: boolean) => void {
  return useCallback(
    (path: string, staged: boolean) => {
      if (projectId === null) return
      const key = diffTabKey(path, staged)
      const label = `${baseName(path)} ${staged ? '(담김)' : '(변경)'}`

      setActive(key)
      // diff 는 다시 열 때마다 새로 읽는다 — 파일과 달리 그 사이에 바뀌었을 수 있다
      setFiles((current) =>
        current.some((file) => file.path === key)
          ? current
          : [...current, { path: key, text: '', label }],
      )

      void window.davis.gitFileDiff({ projectId, path, staged }).then((result) => {
        const rows = result.ok
          ? result.untracked
            ? rowsFromContent(result.diff)
            : parseUnifiedDiff(result.diff)
          : []
        setFiles((current) =>
          current.map((file) =>
            file.path === key
              ? { ...file, rows, ...(result.ok ? {} : { error: result.reason ?? '읽지 못했습니다' }) }
              : file,
          ),
        )
      })
    },
    [projectId, setFiles, setActive],
  )
}

function baseName(path: string): string {
  return path.split('/').pop() ?? path
}
