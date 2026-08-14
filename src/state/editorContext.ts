import { useCallback, useState } from 'react'
import type { ActiveEditorRef, ChatSendPayload } from '../../shared/ipc/channels'
import type { ActiveTab, OpenFile } from './useOpenFiles'

// 지금 편집기에서 보고 있는 것을 채팅 요청에 실을 형태로 만든다.
//
// 이게 없으면 runtime 은 사용자가 무엇을 보고 있는지 모른다 — "이 함수 고쳐줘" 가
// 성립하지 않는다. runtime 쪽 대응 필드는 `ChatData.activeEditor` / `ChatData.dirtyFiles`.
//
// **경로는 프로젝트 루트 상대경로 그대로 둔다.** 절대경로 변환은 main 이 한다 —
// 프로젝트 루트(workspacePath)는 main 에만 있다.

/**
 * 선택 영역. **1-based 라인 번호**다 — 문자 오프셋이 아니다.
 *
 * runtime 의 필드명은 `start_offset`/`end_offset` 이라 오프셋처럼 보이지만, 값은 라인으로
 * 해석된다 (`message_builder.py:18-32` DC-619 follow-up 주석이 명시. vscode·intellij 실측도
 * 1-based 라인). CodeMirror 의 `doc.lineAt(pos).number` 가 이미 1-based 라 그대로 쓴다.
 *
 * **IPC 계약에서 직접 뽑는다** — 따로 선언하면 main 이 키를 갈아도 여기서 안 깨진다.
 * 값이 1-based 라는 것은 타입으로 못 잡으므로 `CodeEditor.test.tsx` 가 값으로 잠근다.
 */
export type EditorSelection = NonNullable<ActiveEditorRef['selection']>

export type { ActiveEditorRef }

/**
 * 채팅 요청에 얹을 편집기 컨텍스트. 전송 지점에서 `...chatContext` 로 그대로 펼친다.
 *
 * **키를 손으로 선언하지 않고 `ChatSendPayload` 에서 뽑는다.** 펼치기(스프레드)는 TS 의
 * 초과 속성 검사를 통과시켜서, 전송 지점에서는 키 이름이 어긋나도 **컴파일이 그냥 된다** —
 * 값만 조용히 사라진다. 여기서 `Pick` 으로 묶어 두면 main 이 키를 갈아치울 때 여기서 깨진다.
 *
 * `dirtyFiles` 만 `Required` 인 것은 의도적 조임이다. 계약상으로는 선택이지만
 * **빈 배열도 보내야** 하므로(= "dirty 없음" 의 명시 신호, DC-603) 렌더러에서는 생략을 막는다.
 */
export type ChatEditorContext = Pick<ChatSendPayload, 'activeEditor' | 'autoContext'> &
  Required<Pick<ChatSendPayload, 'dirtyFiles'>>

/**
 * 실제 파일 탭인가.
 *
 * 가짜 경로를 쓰는 탭이 **둘** 있고 둘 다 거른다. 그대로 보내면 없는 파일을 가리킨다.
 *
 * - `git:staged:` / `git:unstaged:` — git diff 탭 (`useOpenFiles.diffTabKey`)
 * - `ext:{확장이름}:{뷰id}` — 확장 화면 탭 (`useOpenHtmlTab.htmlTabKey`)
 *
 * **확장 쪽은 2026-08-14 에 실측으로 찾았다.** 아래 `activeEditorOf` 의 주석이
 * *"파일 아닌 탭은 `files` 에 없으므로 자연히 걸린다 — 새 탭 종류가 생겨도 안 샌다"*
 * 고 단언했는데, 확장 화면 탭은 **`files` 에 들어간다**(`useOpenHtmlTab` 이 넣는다).
 * 확장 판을 열어 둔 채 대화를 보내면 입력창에 `ext:screen-scenario:…` 이 붙어 나갔다.
 *
 * main 도 방어하지만 여기서 먼저 거른다.
 */
export function isRealFilePath(path: string): boolean {
  return !path.startsWith('git:') && !path.startsWith('ext:')
}

/**
 * 활성 탭이 실제 파일이면 그 참조를, 아니면 null.
 *
 * '대화'·'로그' 같은 파일 아닌 탭은 `files` 에 없으므로 여기서 자연히 걸린다.
 * **그 방어만으로는 부족하다** — `files` 에 들어가면서 파일이 아닌 탭이 둘 있고
 * (git diff · 확장 화면), 그것은 `isRealFilePath` 가 막는다.
 */
export function activeEditorOf(
  files: OpenFile[],
  active: ActiveTab,
  selections: Record<string, EditorSelection>,
): ActiveEditorRef | null {
  if (!isRealFilePath(active)) return null
  if (!files.some((file) => file.path === active)) return null
  const selection = selections[active]
  return { filePath: active, ...(selection ? { selection } : {}) }
}

export interface EditorSelections {
  selections: Record<string, EditorSelection>
  /** 선택이 바뀌었다. 빈 선택(커서만)이면 null 을 줘서 지운다. */
  set: (path: string, range: EditorSelection | null) => void
  drop: (path: string) => void
  clear: () => void
}

/**
 * 파일별 선택 영역 보관.
 *
 * 편집기는 활성 탭만 마운트되므로 컴포넌트 안에 두면 탭을 옮기는 순간 사라진다.
 * 탭을 옮겼다 돌아와도 고르던 범위가 남아 있어야 한다.
 */
export function useEditorSelections(): EditorSelections {
  const [selections, setSelections] = useState<Record<string, EditorSelection>>({})

  const set = useCallback((path: string, range: EditorSelection | null) => {
    setSelections((current) => {
      if (range === null) {
        if (current[path] === undefined) return current // 이미 없다 — 렌더를 부르지 않는다
        const next = { ...current }
        delete next[path]
        return next
      }
      const known = current[path]
      if (known?.startLine === range.startLine && known.endLine === range.endLine) return current
      return { ...current, [path]: range }
    })
  }, [])

  const drop = useCallback((path: string) => set(path, null), [set])
  const clear = useCallback(() => setSelections({}), [])

  return { selections, set, drop, clear }
}

/**
 * 전송에 실을 편집기 컨텍스트를 모은다.
 *
 * 생략 규칙이 필드마다 다르므로 한 곳에 모은다 — `dirtyFiles` 만 **빈 배열도 보낸다**
 * ("dirty 없음" 의 명시 신호이고, 생략은 "IDE 가 알려주지 않음" 이다). 나머지는 비면 뺀다.
 *
 * `recent` 에서 활성 편집기는 이미 빠진 상태로 들어온다 — 같은 파일을 두 번 말할 이유가 없다.
 */
export function chatContextOf<F extends { path: string }>(
  files: F[],
  editor: ActiveEditorRef | null | undefined,
  recent: string[],
  // 미저장 판정은 넘겨받는다 — isDirty 는 useOpenFiles 에 있고, 그쪽이 이 모듈을 쓰므로
  // 여기서 가져오면 순환 참조가 된다
  isDirty: (file: F) => boolean,
): ChatEditorContext {
  return {
    ...(editor ? { activeEditor: editor } : {}),
    ...(recent.length > 0 ? { autoContext: recent } : {}),
    dirtyFiles: files.filter((f) => isRealFilePath(f.path) && isDirty(f)).map((f) => f.path),
  }
}
