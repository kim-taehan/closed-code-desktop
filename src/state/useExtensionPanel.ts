import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ExtensionEntry,
  ExtensionRow,
  ExtensionRowsByView,
  SkippedExtensionEntry,
} from './extensionRows'
import { useExtensionRows } from './useExtensionRows'
import { useExtensionHtml, type ExtensionHtmlByView } from './useExtensionHtml'
import { useExtensionTree, type ExtensionTreesByView } from './useExtensionTree'
import { useExtensionExpanded, type ExtensionExpanded } from './useExtensionExpanded'
import { rowOpenTarget } from './extensionRowTarget'
import type { ExtensionProgressPayload } from '../../shared/ipc/channels'
import { applyProgressLine, type ExtensionProgressLog } from './extensionProgressLog'

// 확장 패널의 IPC 배선. 화면(`ExtensionViewPanel`)은 props 로만 받으므로 여기서 붙인다.
//
// 설정 창의 `useExtensionList` 와 이름이 겹쳐 이쪽을 패널 이름으로 갈랐다. 보는 것이 다르다 —
// 저쪽은 **설치본 관리**(디스크 설치·배포처), 이쪽은 **실행**(명령·결과 행)이다.
//
// 목록은 **앱 단위**다 — 확장 호스트가 앱 수명이라 프로젝트마다 다르지 않다.
// 결과 행만 프로젝트 겉봉을 타고 오고, 겉봉 검사·전환 시 비우기는 `useExtensionRows` 가 한다.

export interface ExtensionPanelHandle {
  extensions: ExtensionEntry[]
  skipped: SkippedExtensionEntry[]
  rowsByView: ExtensionRowsByView
  /** `kind: 'html'` 뷰가 그릴 화면. 행과 따로 온다 (`extensionBridgeSurface.ts`). */
  htmlByView: ExtensionHtmlByView
  treesByView: ExtensionTreesByView
  /** 트리에서 펼쳐 둔 가지. 프로젝트 탭을 다녀와도 남는다 (`useExtensionExpanded`). */
  expanded: ExtensionExpanded
  /**
   * 확장 이름 → 그 확장이 알린 진행 상황. 도는 중이 아닌 확장은 **키가 아예 없다**.
   *
   * `running` 과 다르다 — 저쪽은 **무엇이 도나**, 이쪽은 **어디까지 왔나**다.
   * 목록 갱신은 묶음마다 어시스턴트를 부르므로 수 분이 걸린다.
   *
   * **한 칸이 아니라 확장별로 쥔다.** `redraw` 는 켜진 확장 전부를 돌리므로
   * (`extensionLoader.ts` 의 `redraws`) 진행 알림이 겹친다 — 한 칸이면 늦게 온 확장이
   * 앞엣것을 덮어, 수 분짜리 작업의 줄이 도중에 남의 문구로 바뀌거나 통째로 사라진다.
   */
  progressByExtension: Record<string, ExtensionProgressPayload>
  /** 그중 **쌓이는 줄**만 모은 것. 끝난 뒤에도 남는다 — 무엇이 실패했는지 보는 자리다. */
  progressLog: ExtensionProgressLog
  /**
   * 두 번째 인자는 **사용자가 트리에서 고른 것**. 그런 화면이 아니면 생략된다.
   *
   * **끝났는지·성공했는지**를 돌려준다. 부르는 쪽이 그때 할 일이 있어서다 —
   * 주 행동이 성공하면 고른 것을 푼다 (`ExtensionViewPanel`). 실패를 알리는 일은
   * 여기서 이미 하므로(토스트), 돌려주는 값은 **뒤처리 판단용**이지 오류 통로가 아니다.
   */
  runCommand: (commandId: string, selection?: string[]) => Promise<boolean>
  /**
   * 지금 도는 명령 id 들.
   *
   * 확장 명령은 프로젝트 전체를 훑는 일이 흔해 **수 초가 걸린다.** 표시가 없으면 그동안
   * 화면이 아무 반응 없는 것과 구분되지 않고, 사용자는 버튼을 다시 누른다.
   */
  running: string[]
  /** 결과 행을 눌렀을 때. 파일 칸이 없는 행은 아무 일도 하지 않는다. */
  openRow: (row: ExtensionRow) => void
  /**
   * 목록을 다시 받아온다.
   *
   * 설치는 **설정 창**에서 하고 목록은 여기서 쥔다 — 두 화면이 갈려 있어 설치했다는 사실이
   * 이쪽으로 저절로 오지 않는다. 사이드바 선택기를 펼칠 때 이걸 부른다.
   */
  refresh: () => void
  /**
   * 도는 확장 질의를 끊는다.
   *
   * `running` 은 **여기서 걷지 않는다** — 끊긴 호출이 거부로 돌아오면서 스스로 걷힌다.
   * 미리 걷으면 실제로는 아직 도는데 화면만 끝난 것처럼 보인다.
   */
  cancel: () => void
}

export interface ExtensionPanelOptions {
  projectId: string | null
  /**
   * 목록을 받아올 것인가. 마운트되면 한 번 받아온다.
   *
   * 확장 패널을 보고 있지 않아도 켠다 — **선택기에 항목을 그리려면** 목록이 먼저 있어야
   * 하기 때문이다. 목록은 앱 단위라 프로젝트를 옮겨도 다시 받을 것이 없다.
   */
  active: boolean
  /** 명령 실패를 알린다. 결과가 화면에 안 남는 행동이라 토스트가 그 자리다. */
  onNotice: (text: string) => void
  /** 파일을 연다. `App` 의 `useOpenFiles.open` 이 그대로 내려온다. */
  onOpenFile: (path: string, revealLine?: number) => void
}

export function useExtensionPanel(options: ExtensionPanelOptions): ExtensionPanelHandle {
  const { projectId, active, onNotice, onOpenFile } = options
  const [extensions, setExtensions] = useState<ExtensionEntry[]>([])
  const [skipped, setSkipped] = useState<SkippedExtensionEntry[]>([])
  const rows = useExtensionRows(projectId)
  const html = useExtensionHtml(projectId)
  const tree = useExtensionTree(projectId)
  // 펼쳐 둔 가지. **그리는 쪽이 아니라 여기서 쥔다** — 사이드바는 프로젝트를 옮겨도
  // 보는 확장을 바꿔도 다시 태어나지 않아, 화면이 사라졌다 돌아와도 자리가 남는다.
  const expanded = useExtensionExpanded(projectId)
  // 진행 상황. **프로젝트를 옮기면 지운다** — 다른 프로젝트의 진행을 이 탭이 말하면
  // 사용자는 자기가 시키지 않은 일이 도는 줄 안다.
  const [progressByExtension, setProgressByExtension] = useState<Record<string, ExtensionProgressPayload>>({})
  // 그중 **쌓이는 줄**만 따로 모은다 (`extensionProgressLog`). 한 줄짜리 표시는 다음 것이
  // 오면 사라져, 수 분짜리 작업에서 무엇이 됐는지가 아무 데도 안 남았다.
  const [progressLog, setProgressLog] = useState<ExtensionProgressLog>({})
  useEffect(() => {
    setProgressByExtension({})
    setProgressLog({})
  }, [projectId])
  useEffect(
    () =>
      window.davis.onExtensionProgress((payload, incomingProjectId) => {
        if (incomingProjectId !== projectId) return
        setProgressLog((previous) => applyProgressLine(previous, payload, Date.now()))
        setProgressByExtension((previous) => {
          // `text` 가 null 이면 **끝났다는 뜻**이라 그 확장의 칸만 뺀다.
          // 남의 칸은 건드리지 않는다 — 끝난 확장이 도는 확장의 줄을 지우면 안 된다.
          if (payload.text === null) {
            if (!(payload.extension in previous)) return previous
            const { [payload.extension]: _done, ...rest } = previous
            return rest
          }
          return { ...previous, [payload.extension]: payload }
        })
      }),
    [projectId],
  )

  // 결과는 패널을 보고 있지 않아도 받아 둔다 — 명령을 돌리고 다른 패널에 다녀오면
  // 결과가 사라지는 것을 막는다. 구독은 화면이 붙어 있는 동안만 산다.
  const { apply } = rows
  useEffect(
    () =>
      window.davis.onExtensionRows((payload, incomingProjectId) => {
        apply(incomingProjectId, payload.viewId, payload.rows)
      }),
    [apply],
  )

  const applyTree = tree.apply
  useEffect(
    () =>
      window.davis.onExtensionTree((payload, incomingProjectId) => {
        applyTree(incomingProjectId, payload.viewId, payload.nodes)
      }),
    [applyTree],
  )

  const applyHtml = html.apply
  useEffect(
    () =>
      window.davis.onExtensionHtml((payload, incomingProjectId) => {
        applyHtml(incomingProjectId, payload.viewId, payload.html)
      }),
    [applyHtml],
  )

  // **저장된 것을 다시 그려 달라고 청한다.** 위 구독 셋이 붙은 **뒤에** 부른다 —
  // 확장이 활성화될 때 한 번 그리는 것은 화면이 붙기 전에 끝날 수 있고, 밀어 넣기는
  // 재생되지 않아 그대로 사라진다. 프로젝트를 옮기면 화면이 비워지므로(`useExtensionTree`)
  // 여기서 다시 청하지 않으면 **껐다 켠 뒤·탭을 옮긴 뒤 목록이 통째로 사라져 보인다.**
  //
  // 실패는 삼킨다 — 확장이 없거나 호스트가 아직 안 떴을 뿐이고, 사용자가 할 일이 없다.
  useEffect(() => {
    if (projectId === null) return
    void window.davis.redrawExtensionViews().catch(() => {})
  }, [projectId])

  // 알림 함수는 **의존성에 넣지 않고 ref 로 읽는다.**
  // 아래 효과가 setState 를 하므로, 부르는 쪽이 인라인 함수를 넘기는 순간
  // 매 렌더마다 효과가 다시 돌아 목록을 무한히 다시 받아온다. 지금은 안정된
  // 콜백(`useToasts.show`)이 오지만, 그 사실에 기대면 나중에 조용히 깨진다.
  const noticeRef = useRef(onNotice)
  noticeRef.current = onNotice

  // 늦게 온 응답이 화면을 되돌리지 않게 한다 (`useGitState.ts:44-55` 와 같은 규칙).
  // 확장 싣기를 기다렸다 답하므로 이 응답은 실제로 늦을 수 있다.
  //
  // **부르는 쪽마다 살아 있음을 따로 센다.** 화면이 사라져도 마지막에 건 요청만 버리면 되고,
  // 훅 전체가 하나의 깃발을 나눠 쓰면 새로 건 요청이 앞엣것 때문에 버려진다.
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const refresh = useCallback(() => {
    void window.davis
      .listExtensions()
      .then((payload) => {
        if (!alive.current) return
        // **켜진 것만 본다.** 꺼진 확장은 호스트에 실리지 않아 명령이 거부되고 결과 행도
        // 오지 않는다 — 그런 것을 사이드바에 남기면 눌러도 아무 일이 없는 칸이 된다.
        // 꺼진 것을 목록에 남기는 자리는 **설정 창**(`useExtensionList`)이다. 거기가
        // 관리하는 자리고 여기는 실행하는 자리다.
        setExtensions(payload.extensions.filter((extension) => extension.enabled))
        setSkipped(payload.skipped)
      })
      .catch((error: unknown) => {
        if (alive.current) noticeRef.current(`확장 목록을 읽지 못했습니다: ${describe(error)}`)
      })
  }, [])

  // 목록은 훑기 결과라 main 이 계산해 쥐고 있다(`ExtensionService.scan`). 한 번 받아오면 되고,
  // 설치로 바뀌는 자리는 `refresh` 가 맡는다.
  useEffect(() => {
    if (active) refresh()
  }, [active, refresh])

  const [running, setRunning] = useState<string[]>([])

  const runCommand = useCallback(
    (commandId: string, selection?: string[]) => {
      setRunning((previous) => [...previous, commandId])
      return window.davis
        // 고른 것이 없으면 필드를 아예 빼서 보낸다 — "고른 것이 없다" 와 "그런 화면이
        // 아니다" 를 확장이 구분할 이유가 없고, 빈 배열을 보내면 그 둘이 같아진다.
        .runExtensionCommand({ commandId, ...(selection?.length ? { selection } : {}) })
        .then(() => true)
        .catch((error: unknown) => {
          onNotice(`명령을 실행하지 못했습니다: ${describe(error)}`)
          // **거절을 다시 던지지 않는다.** 알리는 일은 여기서 끝났고, 부르는 쪽마다
          // catch 를 달게 하면 하나라도 빠뜨리는 순간 콘솔에 미처리 거부가 쌓인다.
          return false
        })
        .finally(() => {
          // 같은 명령이 두 번 걸렸을 수 있다. 값으로 지우지 말고 **한 자리만** 뺀다
          // (`ExtensionService.runCommand` 가 겉봉을 거둘 때와 같은 규칙).
          setRunning((previous) => {
            const at = previous.indexOf(commandId)
            return at === -1 ? previous : [...previous.slice(0, at), ...previous.slice(at + 1)]
          })
        })
    },
    [onNotice],
  )

  const cancel = useCallback(() => {
    void window.davis.cancelExtension().catch(() => {})
  }, [])

  const openRow = useCallback(
    (row: ExtensionRow) => {
      const target = rowOpenTarget(row)
      if (target === null) return
      onOpenFile(target.path, target.line)
    },
    [onOpenFile],
  )

  return {
    extensions,
    skipped,
    rowsByView: rows.rowsByView,
    htmlByView: html.htmlByView,
    treesByView: tree.treesByView,
    expanded,
    progressByExtension,
    progressLog,
    runCommand,
    running,
    openRow,
    refresh,
    cancel,
  }
}

/**
 * IPC 거부 메시지를 읽을 만하게 줄인다.
 *
 * `ipcMain.handle` 이 거부하면 renderer 에는
 * `Error invoking remote method 'extension:runCommand': Error: 실제 사유` 로 온다 —
 * 앞머리를 떼지 않으면 토스트가 채널 이름으로 시작해 정작 사유가 잘린다.
 */
function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']*':\s*/, '').replace(/^Error:\s*/, '')
}
