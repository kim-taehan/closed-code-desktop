import { useRecentSaves } from './recentSaves'
import { useOpenDiffTab } from './useOpenDiffTab'
import { useOpenHtmlTab } from './useOpenHtmlTab'
import { useCallback, useEffect, useRef, useState } from 'react'
import { activeEditorOf, chatContextOf, useEditorSelections } from './editorContext'
import { openTargetOf } from './externalOpen'
import { REASON_TEXT, WRITE_REASON, toFile } from './fileReasons'
import { isDirty } from './openFilesTypes'
import type { ActiveTab, OpenFile, OpenFilesApi } from './openFilesTypes'

// 열린 파일들과 지금 보고 있는 것.
//
// 프로젝트마다 따로 두지 않고 프로젝트가 바뀌면 비운다 —
// 파일 탭이 프로젝트를 넘나들면 어느 프로젝트의 파일인지 알 수 없다.

// 탭 하나의 모양·식별자 규칙과 표면은 `openFilesTypes.ts` 에 있다.
// **여기서 다시 낸다** — 지금까지 이 파일에서 가져다 쓰던 곳이 그대로 돌아야 한다.
export { isDirty, diffTabKey } from './openFilesTypes'
export type { OpenFile, OpenFilesApi, ActiveTab } from './openFilesTypes'

/** 마지막 타이핑 뒤 이만큼 조용하면 저장한다. */
const AUTOSAVE_MS = 600

export function useOpenFiles(
  projectId: string | null,
  /** 외부 열기 실패 알림 (useToasts.show). 결과가 화면에 안 보이는 실패라 알려야 한다. */
  notify?: (text: string, tone?: 'info' | 'error') => void,
): OpenFilesApi {
  const [files, setFiles] = useState<OpenFile[]>([])
  const [active, setActive] = useState<ActiveTab>('chat')
  const selection = useEditorSelections()
  const saves = useRecentSaves()

  // save·close 는 콜백 시점의 최신 목록이 필요하다 (setState 밖에서 파일을 찾는다).
  const filesRef = useRef(files)
  filesRef.current = files

  // 자동 저장 대기표 — 파일마다 하나. 새로 치면 앞의 것을 물린다.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  // 프로젝트가 바뀌면 파일 탭을 비운다
  useEffect(() => {
    // 기다리던 저장은 버린다 — save 는 **지금** projectId 로 쓰므로, 그대로 두면
    // 이전 프로젝트의 파일을 새 프로젝트에 쓴다. 포커스가 빠질 때 이미 저장했다.
    for (const timer of timers.current.values()) clearTimeout(timer)
    timers.current.clear()
    setFiles([])
    setActive('chat')
    selection.clear()
    saves.clear() // 남의 프로젝트 경로가 autoContext 로 따라가면 안 된다
  }, [projectId])

  const open = useCallback(
    (path: string, revealLine?: number) => {
      if (projectId === null) return
      setActive(path)
      // 이미 열려 있으면 탭을 새로 만들지 않는다 — 탭을 오가는 것이 흔하다.
      // 갈 줄만 갱신한다 (같은 파일을 다른 변경 지점으로 다시 열 수 있다).
      setFiles((current) => {
        const known = current.find((file) => file.path === path)
        if (known === undefined) return [...current, { path, text: '', revealLine }]
        if (known.revealLine === revealLine) return current
        return current.map((file) => (file.path === path ? { ...file, revealLine } : file))
      })

      void window.davis.readFile({ projectId, path }).then((result) => {
        setFiles((current) =>
          current.map((file) => (file.path === path ? toFile(path, result, revealLine) : file)),
        )
      })
    },
    [projectId],
  )

  // 라우팅은 `/open` 에서만 — 트리·검색·cmd+p 는 기존대로 뷰어 탭이다 (사용자 지시, 2026-07-23).
  // 뷰어는 텍스트 전용이라 `/open` 으로 고른 pdf·이미지는 OS 기본 앱, 압축·설치 파일은 Finder 로.
  const openRouted = useCallback(
    (path: string) => {
      if (projectId === null) return
      const target = openTargetOf(path)
      if (target === 'viewer') return open(path)
      void window.davis.openInOs({ projectId, path, mode: target }).then((result) => {
        if (!result.ok)
          notify?.(REASON_TEXT[result.reason ?? ''] ?? `열지 못했습니다 — ${result.reason}`, 'error')
      })
    },
    [projectId, notify, open],
  )

  const save = useCallback(
    async (path: string) => {
      if (projectId === null) return
      const file = filesRef.current.find((f) => f.path === path)
      if (file === undefined || file.draft === undefined || !isDirty(file)) return

      // **던지는 것을 여기서 받는다.** 이 함수를 부르는 자리는 둘 다 `void` 라
      // (`edit` 의 타이머 · `flush`) 예외가 나면 아무 데도 안 잡히고 조용히 사라진다 —
      // 사용자에게는 「자동 저장이 그냥 안 된다」로 보이고, 화면 어디에도 이유가 없다.
      // IPC 가 통째로 안 붙은 때(핸들러 미등록·프로젝트 사라짐)가 그 모양이 된다.
      const result = await window.davis
        .writeFile({
          projectId,
          path,
          text: file.draft,
          expectedMtimeMs: file.mtimeMs ?? 0,
        })
        .catch((error: unknown) => ({
          ok: false as const,
          reason: error instanceof Error ? error.message : 'threw',
        }))

      if (!result.ok) {
        notify?.(WRITE_REASON[result.reason ?? ''] ?? '저장하지 못했습니다', 'error')
        // 그 사이 바뀐 파일은 더 시도하지 않는다 — 칠 때마다 같은 실패를 알리게 된다.
        // 고친 내용은 화면에 그대로 두고, 탭을 다시 열면 새로 읽어 풀린다.
        if (result.reason === 'stale')
          setFiles((current) =>
            current.map((f) => (f.path === path ? { ...f, conflict: true } : f)),
          )
        return
      }
      // 방금 손댄 파일로 기록한다 — autoContext 의 재료 (recentSaves.ts)
      saves.record(path)
      // 쓴 내용을 text 로 끌어올려 미저장 표시를 지운다. draft 는 그대로 두고 계속 고친다.
      setFiles((current) =>
        current.map((f) =>
          f.path === path ? { ...f, text: f.draft ?? f.text, mtimeMs: result.mtimeMs } : f,
        ),
      )
    },
    [projectId, notify, saves],
  )

  // 타이머는 만들어질 때의 save 를 붙든다. 한 겹 두어 늘 최신 것을 부른다.
  const saveRef = useRef(save)
  saveRef.current = save

  // 편집 버퍼는 공유 상태에 둔다 — OpenTab 은 활성 탭만 마운트해서, 탭을 오가면 로컬 state 는 사라진다.
  //
  // 저장은 타이핑이 멈춘 뒤 한 번만 한다. 글자마다 쓰면 에이전트가 읽는 파일이
  // 반쯤 쓰다 만 상태로 계속 바뀐다.
  const edit = useCallback((path: string, draft: string) => {
    setFiles((current) => current.map((file) => (file.path === path ? { ...file, draft } : file)))
    // 내용이 바뀌면 보관하던 선택을 버린다 — 라인 번호가 밀려 **다른 곳을 가리키게 된다**.
    // 옮겨 따라가게 만들 수도 있지만, 잘못 가리킨 범위를 모델에 보내는 것보다
    // 안 보내는 쪽이 낫다 (모델은 선택이 없으면 파일 전체를 본다).
    selection.drop(path)

    if (filesRef.current.find((f) => f.path === path)?.conflict === true) return
    const waiting = timers.current.get(path)
    if (waiting !== undefined) clearTimeout(waiting)
    timers.current.set(
      path,
      setTimeout(() => {
        timers.current.delete(path)
        void saveRef.current(path)
      }, AUTOSAVE_MS),
    )
  }, [selection.drop])

  const flush = useCallback((path: string) => {
    const waiting = timers.current.get(path)
    if (waiting === undefined) return
    clearTimeout(waiting)
    timers.current.delete(path)
    void saveRef.current(path)
  }, [])

  /**
   * 여러 탭을 한 번에 닫는다 (탭 우클릭의 「나머지·왼쪽·오른쪽 모두 닫기」).
   *
   * 한 개짜리 `close` 도 이걸 탄다 — 닫기 규칙이 두 벌이 되면 한쪽만 고쳐진다.
   * **한 번의 setState 로 끝낸다.** `close` 를 반복 호출하면 렌더가 닫는 수만큼 돌고,
   * 중간 상태마다 `active` 가 대화로 튀었다 돌아온다.
   */
  const closeMany = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return
      const doomed = new Set(paths)

      for (const path of paths) {
        // 닫으면 draft 도 사라진다 — 기다리던 저장이 있으면 먼저 쓴다
        flush(path)
        // 닫은 탭의 선택도 버린다 — 안 버리면 같은 파일을 다시 열었을 때 옛 범위가 되살아난다
        selection.drop(path)
      }

      setFiles((current) => current.filter((file) => !doomed.has(file.path)))
      // 보고 있던 탭을 닫으면 대화로 돌아간다 — 남은 파일로 튀면 어디로 갔는지 모른다
      setActive((current) => (doomed.has(current) ? 'chat' : current))
    },
    [flush, selection.drop],
  )

  const close = useCallback((path: string) => closeMany([path]), [closeMany])

  const openDiff = useOpenDiffTab(projectId, setFiles, setActive)
  const openHtml = useOpenHtmlTab(setFiles, setActive)

  // 채팅에 실을 편집기 컨텍스트. git diff 탭은 실제 파일이 아니라 양쪽에서 거른다.
  const editor = activeEditorOf(files, active, selection.selections)
  const chatContext = chatContextOf(files, editor, saves.recent(editor?.filePath), isDirty)

  return {
    files,
    active,
    open,
    openRouted,
    openDiff,
    openHtml,
    close,
    closeMany,
    select: setActive,
    edit,
    flush,
    setSelection: selection.set,
    chatContext,
  }
}

