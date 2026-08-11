import { useCallback, useRef } from 'react'
import { isRealFilePath } from './editorContext'

// 최근에 저장한 파일 — `chat_request.autoContext` 의 재료.
//
// **저장 시점으로 잡는다.** vscode 원본이 `onDidSaveTextDocument` 하나만 듣는다
// (RecentFileTracker.ts:55). 타이핑마다 잡으면 잠깐 열어본 파일까지 섞이고, 열기로 잡으면
// 훑어만 본 파일이 들어간다 — "방금 손댄 곳" 이라는 뜻이 흐려진다.
//
// git 워킹트리 변경분(gitState)으로 대신하지 않는 이유: 그건 "최근 수정" 이 아니라
// "커밋 안 된 것" 이다. 커밋 직후엔 비고, 브랜치를 갓 체크아웃하면 무관한 파일이 잔뜩 잡힌다.

/** 추적 상한. 넘으면 오래된 것부터 버린다 (vscode MAX_TRACKED_FILES 미러) */
const MAX_TRACKED = 20
/** 한 요청에 실어 보내는 최대 개수 (vscode MAX_AUTO_CONTEXT_FILES 미러). runtime 은 20 에서 자른다 */
const MAX_SENT = 10

export interface RecentSaves {
  /** 저장이 성공한 순간 부른다 */
  record: (path: string) => void
  /** 최근 것부터 최대 10개. `except` 에 든 경로는 뺀다 (보통 활성 편집기) */
  recent: (except?: string | undefined) => string[]
  /** 프로젝트를 옮기면 비운다 — 남의 프로젝트 경로가 따라가면 안 된다 */
  clear: () => void
}

export function useRecentSaves(): RecentSaves {
  // 순서가 뜻을 가진다 — Set 은 삽입 순서를 지키므로 재삽입으로 "가장 최근" 을 만든다
  const seen = useRef<Set<string>>(new Set())

  const record = useCallback((path: string) => {
    if (!isRealFilePath(path)) return // git: 가짜 탭은 실제 파일이 아니다
    seen.current.delete(path) // 이미 있으면 맨 뒤로 옮긴다
    seen.current.add(path)
    while (seen.current.size > MAX_TRACKED) {
      const oldest = seen.current.values().next().value
      if (oldest === undefined) break
      seen.current.delete(oldest)
    }
  }, [])

  const recent = useCallback(
    (except?: string | undefined) =>
      [...seen.current].reverse().filter((path) => path !== except).slice(0, MAX_SENT),
    [],
  )

  const clear = useCallback(() => seen.current.clear(), [])

  return { record, recent, clear }
}
