import { isAbsolute, resolve } from 'node:path'
import type { ActiveEditorRef, ChatSendContext } from '../../shared/ipc/chatPayloads'

// renderer 가 준 편집기 컨텍스트를 runtime 이 받을 수 있는 형태로 손본다.
//
// **변환은 여기 한 곳뿐이다.** 두 가지를 한다:
//
//  1. 프로젝트 루트 상대경로 → 절대경로. renderer 의 탭 식별자는 루트 상대경로이고
//     (useOpenFiles.ts:12-20), runtime 은 절대경로를 기대한다 — `dirty_files` 는
//     `Path(p).resolve()` 로 정규화돼 turn 동안의 직접 쓰기 거부 목록이 되고
//     (turn_transaction/service.py:188-190), 세 IDE 플러그인도 전부 절대경로를 싣는다.
//     경로가 어긋나면 **에러 없이 가드가 그냥 안 걸린다.**
//
//  2. `git:staged:` / `git:unstaged:` 가짜 탭 제외. git diff 탭은 실제 파일이 아니라
//     "같은 파일이라도 스테이지 전/후는 다른 탭" 을 위한 식별자다 (useOpenFiles.ts:53-56
//     `diffTabKey`). renderer 가 걸러 보내더라도 여기서 한 번 더 막는다 — 이 경로가 새면
//     runtime 이 존재하지 않는 파일을 붙들고, `extra='ignore'` 라 아무도 항의하지 않는다.

/** git diff 탭 식별자의 접두사. 실제 파일 경로가 아니다. */
const GIT_TAB_PREFIX = 'git:'

function isGitDiffTab(path: string): boolean {
  return path.startsWith(GIT_TAB_PREFIX)
}

function toAbsolute(path: string, workspacePath: string): string {
  return isAbsolute(path) ? path : resolve(workspacePath, path)
}

function normalizeActiveEditor(
  editor: ActiveEditorRef | undefined,
  workspacePath: string,
): ActiveEditorRef | undefined {
  // 가짜 탭을 보고 있으면 activeEditor 자체를 내지 않는다 — 없는 파일을 가리키느니 없는 편이 낫다
  if (editor === undefined || isGitDiffTab(editor.filePath)) return undefined
  return {
    filePath: toAbsolute(editor.filePath, workspacePath),
    ...(editor.selection ? { selection: editor.selection } : {}),
  }
}

/**
 * 경로를 절대경로로 바꾸고 `git:` 가짜 탭을 걸러낸 **컨텍스트 전체**를 돌려준다.
 *
 * 조각만 돌려주면 호출부가 `{ ...context, ...조각 }` 으로 합치게 되는데,
 * 걸러내서 사라진 `activeEditor` 가 원본 스프레드에 남아 필터가 무력해진다.
 * 그래서 통째로 받아 통째로 돌려준다.
 */
export function normalizeSendContext(context: ChatSendContext, workspacePath: string): ChatSendContext {
  const activeEditor = normalizeActiveEditor(context.activeEditor, workspacePath)
  // dirtyFiles 는 **빈 배열이어도 살려 보낸다** — `[]` 는 "dirty 없음" 의 명시 신호다 (DC-603).
  // 걸러낸 결과가 비었다고 undefined 로 접으면 그 신호가 사라진다.
  const dirtyFiles =
    context.dirtyFiles === undefined
      ? undefined
      : context.dirtyFiles.filter((path) => !isGitDiffTab(path)).map((path) => toAbsolute(path, workspacePath))

  // autoContext 는 **이미 다른 필드로 말한 파일을 빼고** 절대경로로 바꾼다.
  // 활성 편집기는 renderer 가 이미 뺐지만, contextFiles(`@` 멘션·첨부·보고 있는 문서)는
  // 여기서만 둘 다 보인다 — 같은 파일을 두 번 말하면 프롬프트만 길어지고,
  // runtime 은 20개에서 자르므로(message_builder.py) 중복이 진짜 힌트를 밀어낸다.
  const spoken = new Set([
    ...(activeEditor ? [activeEditor.filePath] : []),
    ...(context.files ?? []).map((file) => file.filePath),
  ])
  const autoContext = context.autoContext
    ?.filter((path) => !isGitDiffTab(path))
    .map((path) => toAbsolute(path, workspacePath))
    .filter((path) => !spoken.has(path))

  const { activeEditor: _dropped, dirtyFiles: _also, autoContext: _third, ...rest } = context
  return {
    ...rest,
    ...(activeEditor ? { activeEditor } : {}),
    ...(dirtyFiles !== undefined ? { dirtyFiles } : {}),
    // 비면 뺀다 — dirtyFiles 와 달리 "없음" 을 알릴 이유가 없다
    ...(autoContext && autoContext.length > 0 ? { autoContext } : {}),
  }
}
