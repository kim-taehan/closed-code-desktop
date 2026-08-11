import { useEffect, useRef } from 'react'
import type { ActiveEditorRef } from './editorContext'

// 편집기에서 **보고 있는 것이 바뀌면 main 에 알린다.** 확장이 그 값을 쓴다
// (`workspace.activeFile()` 로 당기거나 `onActiveFile` 로 받는다).
//
// **`useOpenFiles` 안에 넣지 않았다.** 그 파일이 298줄이라 300줄 상한에 닿는다 —
// 그리고 이건 별개 관심사다: 열린 탭을 쥐는 일과, 그 사실을 바깥에 알리는 일.
//
// 값의 주인은 렌더러다. main 은 여기서 받은 마지막 값을 들고 있을 뿐이라,
// **이 훅을 안 부르면 확장은 늘 `null` 을 본다** — 그런데 그게 「아무것도 안 보고 있다」와
// 같은 답이라 조용히 빈 화면이 된다. 배선을 빠뜨렸는지는 화면에 안 나타난다.

/** 채팅에 싣는 것과 **같은 값**을 쓴다 — 두 곳이 갈리면 확장과 에이전트가 다른 파일을 본다. */
export interface ActiveFileSource {
  activeEditor?: ActiveEditorRef
}

/**
 * 바뀔 때만 보낸다.
 *
 * 커서를 한 줄 옮길 때마다 확장이 깨어나면, 파일 하나를 읽는 동안 수십 번 돈다.
 * 그래서 **경로와 시작 줄이 둘 다 그대로면 안 보낸다.** 끝 줄은 안 본다 — 드래그로
 * 영역을 넓히는 동안 계속 바뀌는데, 확장이 알고 싶은 것은 「어느 함수 안인가」다.
 */
export function useActiveFileNotice(context: ActiveFileSource): void {
  const last = useRef<string | null>(null)

  useEffect(() => {
    const editor = context.activeEditor
    const path = editor?.filePath ?? null
    const line = editor?.selection?.startLine
    const key = path === null ? null : `${path}:${line ?? ''}`
    if (key === last.current) return
    last.current = key

    // 아무것도 안 보고 있으면 null 이다. **빈 객체를 만들지 않는다** —
    // 「경로 없는 파일」은 「안 보고 있다」와 구분되지 않는다.
    window.davis.notifyActiveFile(
      path === null ? null : line !== undefined ? { path, line } : { path },
    )
  }, [context.activeEditor])
}
