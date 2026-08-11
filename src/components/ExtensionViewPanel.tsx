import { useCallback, useEffect, useState } from 'react'
import { htmlTabKey } from '../state/useOpenHtmlTab'
import { t } from '../i18n/messages'
import type { ExtensionPanelTarget } from '../state/extensionPanels'
import type { ExtensionRowsByView } from '../state/extensionRows'
import type { ExtensionRow } from '../state/extensionRows'
import { collectExtensions, filterByExtension } from '../state/extensionRowFilter'
import { exportRowsCsv } from '../state/extensionCsvExport'
import type { RowSort } from '../state/extensionRowSort'
import { useExtensionPicks } from '../state/extensionPicks'
import type { ExtensionExpanded } from '../state/useExtensionExpanded'
import { ExtensionTablePane } from './ExtensionTablePane'
import { ExtensionTreePane } from './ExtensionTreePane'
import { ExtensionViewTabs } from './ExtensionViewTabs'
import { ExtensionActionBar } from './ExtensionActionBar'
import { ExtensionTabActions } from './ExtensionTabActions'
import { commandSlots, viewCommands } from '../state/extensionCommandSlots'
import { tabCountOf } from '../state/extensionTabCounts'
import type { TreeNode } from '../state/extensionTree'
import type { ExtensionProgressPayload } from '../../shared/ipc/channels'
import { linesOf, type ExtensionProgressLog } from '../state/extensionProgressLog'
import '../styles/extensions.css'

// 사이드바가 **확장 하나**를 그릴 때의 본문 (`SidebarPanelSelect` 에서 고른 그 확장).
//
// ⚠️ runtime 의 **플러그인(Plugin)** 과 다른 체계다. 문구를 섞지 않는다.
//
// `ExtensionsPanel` 과 보는 것이 다르다: 저쪽은 **설치된 것 전부**(확장 목록·건너뜀·모든 뷰)를
// 한 화면에 펼친다. 이쪽은 사용자가 고른 확장 하나만 본다.
//
// **뷰는 탭으로 가른다.** 예전에는 뷰마다 선택기 항목이 하나씩 생겨, 뷰를 셋 선언한 확장
// 하나가 사이드바 선택기를 세 줄 차지했다 (`extensionPanels.ts` 머리말).
//
// **명령 버튼을 뷰와 같이 둔다.** 표는 명령을 돌려야 채워지는데, 돌리는 자리가 설정 창에
// 있으면 사용자가 빈 표 앞에서 무엇을 눌러야 하는지 알 수 없다. 어느 명령이 어느 뷰를
// 채우는지는 매니페스트가 말해 주지 않으므로, **그 확장의 명령을 전부** 싣는다.
//
// 거르개·정렬·내보내기는 **앱이 얹는 것**이지 확장이 선언하는 것이 아니다. 그래서 `file`
// 규약을 따르는 모든 확장 표가 같이 얻는다.

export interface ExtensionViewPanelProps {
  target: ExtensionPanelTarget
  /**
   * 고른 것·펼친 것을 프로젝트별로 가르는 열쇠.
   *
   * 이 패널은 확장이 바뀔 때만 다시 태어나고(`key={target.id}`) 프로젝트 전환에는
   * 살아남는다 — 가르지 않으면 다른 프로젝트에서 만든 상태가 그대로 이어진다.
   */
  projectId: string | null
  /** 뷰 id → 트리에서 펼쳐 둔 가지 (`useExtensionExpanded`) */
  expanded: ExtensionExpanded
  /**
   * 뷰 id → 그 뷰에 마지막으로 들어온 행들.
   *
   * **없는 키와 빈 배열은 다른 상태다** — 앞은 "아직 안 돌렸다", 뒤는 "돌렸는데 찾은 것이
   * 없다" 이고, 둘을 같은 문구로 보여주면 사용자에게는 **버튼이 안 먹은 것**과 구분되지
   * 않는다. (실측: 확장이 훑는 대상이 하나도 없는 프로젝트에서 명령은 **거부 없이 0행으로**
   * 끝난다 — 실패가 아니라서 토스트도 안 뜬다.)
   */
  rowsByView: ExtensionRowsByView
  /** 뷰 id → `kind: 'html'` 뷰가 그릴 화면. 규칙은 `rowsByView` 와 같다. */
  htmlByView: Record<string, string>
  /** 뷰 id → `kind: 'tree'` 뷰가 그릴 마디들. 규칙은 `rowsByView` 와 같다. */
  treesByView: Record<string, TreeNode[]>
  /** 지금 도는 명령 id 들 */
  running: string[]
  /**
   * 확장 이름 → 그 확장이 알린 진행 상황. 도는 중이 아닌 확장은 키가 없다.
   *
   * **잠긴 버튼만으로는 부족하다** — 목록 갱신은 묶음마다 어시스턴트를 부르므로 수 분이
   * 걸리고, 그동안 화면에 아무 변화가 없으면 사용자는 멈춘 것으로 읽는다.
   *
   * **가르는 것은 여기서 한다** — 자기가 어느 확장인지(`target`) 아는 것은 이 패널뿐이다.
   * 통째로 받아 `target.extension.name` 것만 그린다. 안 그러면 `redraw` 가 함께 돌린
   * 남의 확장 문구가 이 바에 찍힌다 (실측: 테스트 시나리오 바에 현행분석의 analyzer 문구).
   */
  progressByExtension: Record<string, ExtensionProgressPayload>
  /** 확장 이름 → 쌓인 진행 줄. 가르는 규칙은 `progressByExtension` 과 같다. */
  progressLog: ExtensionProgressLog
  /**
   * 두 번째 인자는 트리에서 고른 것. 고른 것이 없으면 생략된다.
   * 돌려주는 값은 **성공했나** — 뒤처리(고른 것 풀기)를 가르는 데 쓴다.
   */
  onRunCommand: (commandId: string, selection?: string[]) => Promise<boolean>
  /** 도는 질의를 끊는다 */
  onCancel: () => void
  onOpenRow: (row: ExtensionRow) => void
  /** 트리에서 이름을 눌렀을 때. 고르는 것(체크박스)과 **다른 몸짓**이다. */
  onOpenPath: (path: string) => void
  /**
   * 확장 화면을 본문 탭으로 연다 (`useOpenFiles.openHtml`).
   *
   * 사이드바가 직접 그리지 않고 넘기는 이유: 폭(약 300px)에 분석 표가 안 들어간다.
   * 실측 산출물 01 은 칸이 12개인데 셋만 겨우 들어가 경로·요약이 통째로 빠진다.
   */
  onOpenHtml: (key: string, label: string, html: string, focus?: boolean) => void
  /** 내보내기 결과처럼 화면에 흔적이 안 남는 일을 알린다 */
  onNotice: (text: string) => void
}

export function ExtensionViewPanel(props: ExtensionViewPanelProps) {
  const { target, rowsByView, htmlByView, treesByView, expanded, onOpenHtml, onNotice } = props
  const slots = commandSlots(target.extension.contributes?.commands ?? [])

  // 어느 탭을 보고 있나. 빈 값이면 첫 뷰다 — 확장을 바꾸면 `key` 로 통째 다시 태어난다
  // (`ProjectSidebar`), 그래서 여기서 되돌리는 효과를 걸 자리가 없다.
  const [activeViewId, setActiveViewId] = useState('')
  // **`kind: 'html'` 뷰는 탭에서 뺀다.** 결과는 본문 탭에 그려지므로 사이드바 쪽은
  // 「오른쪽에 열었습니다」 한 줄짜리 빈 껍데기인데, 탭 폭의 3분의 1을 먹었다 (기획서 §1-4).
  // 전부 html 인 확장(`program-map`)은 뺄 것이 없으므로 그대로 둔다.
  const tabViews = target.views.some((one) => one.kind !== 'html')
    ? target.views.filter((one) => one.kind !== 'html')
    : target.views
  const view = tabViews.find((one) => one.id === activeViewId) ?? tabViews[0]
  const viewId = view?.id ?? ''

  // 고른 것은 **탭마다 따로 쥐되 합쳐서 보낸다** — 화면 둘과 API 하나를 골라 한 번에
  // 돌리는 것이 본래 용법이라, 탭을 옮길 때 앞 탭의 선택이 풀리면 두 번 나눠 돌려야 한다.
  const picks = useExtensionPicks(props.projectId, treesByView)

  // 지금 보는 탭에 붙은 준비 행동. 탭을 옮기면 함께 바뀐다 — 그것이 이 자리의 전부다
  const tabCommands = viewCommands(target.extension.contributes?.commands ?? [], viewId)

  // 결과 화면은 **탭과 무관하게** 오른쪽에 띄운다. 명령을 돌린 탭(API)에 머무는 것이
  // 보통이라, 보고 있는 탭이 결과 탭일 때만 열면 다 쓰고도 아무 변화가 없어 보인다.
  const htmlView = target.views.find((one) => one.kind === 'html')
  const htmlOfHtmlView = htmlView === undefined ? undefined : htmlByView[htmlView.id]
  const showOnRight = useCallback(
    (focus = false) => {
      if (htmlView === undefined || htmlOfHtmlView === undefined) return
      onOpenHtml(htmlTabKey(target.extension.name, htmlView.id), htmlView.title, htmlOfHtmlView, focus)
    },
    [htmlView, htmlOfHtmlView, onOpenHtml, target.extension.name],
  )

  // 결과가 올라오면 **바로** 오른쪽에 띄운다. 한 번 더 누르게 하면, 명령을 돌린 뒤
  // 사이드바에 아무 변화가 없어 "안 먹었다" 로 보인다 (이 레포의 단골 실패).
  // **앞으로 끌어오지는 않는다** — 진행 갱신이 몇 초마다 오므로 그동안 다른 파일을 볼 수 없다.
  useEffect(() => {
    showOnRight()
  }, [showOnRight])

  /**
   * 명령을 걸고, 끝나면 **결과 화면으로 데려간다.**
   *
   * 사람이 누른 것은 「그 화면으로 가겠다」는 말이다 — 밀려온 갱신과 달리 앞으로 끌어온다.
   * 위의 효과는 이 시점에 아직 새 HTML 을 못 받았을 수 있는데, 데려가는 것은 **탭 열쇠**로
   * 하므로 상관없다 (내용은 곧 뒤따라 온다). 처음 도는 명령이면 HTML 이 아예 없어 여기서는
   * 아무 일도 안 하고, 잠시 뒤 첫 갱신이 그때 탭을 열며 앞으로 끌어온다.
   */
  const runAndShow = (commandId: string, selection?: string[]) =>
    props.onRunCommand(commandId, selection).then((ok) => {
      if (ok) showOnRight(true)
      return ok
    })

  // 거르개·정렬은 **여기서** 쥔다. 표 안에 두면 결과가 비었다 돌아올 때마다 풀리고,
  // 내보내기 버튼(명령 줄에 있다)이 무엇을 내보낼지 못 본다.
  // 트리를 좁히는 글. **고른 것은 건드리지 않는다** — 거르개는 보는 조건이지 선택이 아니라,
  // 좁혀 둔 채 명령을 걸어도 안 보이는 곳에서 고른 것이 함께 나간다.
  const [find, setFind] = useState('')
  // 고른 경로 조각 (칩). 글과 **겹쳐** 건다 — 갈래를 칩으로 좁히고 이름을 글로 짚는다.
  const [segment, setSegment] = useState('')
  const [ext, setExt] = useState<string | null>(null)
  const [sort, setSort] = useState<RowSort | null>(null)

  const rows = rowsByView[viewId]
  const nodes = treesByView[viewId]

  // 세는 일은 `extensionTabCounts` 가 한다 — 좁히기는 **모든 탭에 같이** 걸린다
  const countOf = (id: string) => tabCountOf(id, treesByView, rowsByView, segment, find)
  const options = rows === undefined ? [] : collectExtensions(rows)
  // 고른 확장자가 지금 결과에 없으면(다시 훑어 사라졌다) 전체로 본다.
  // 상태를 되돌리는 효과를 걸지 않는다 — 순수하게 유도하면 어긋날 자리가 없다.
  const pickedText = tabViews
    .filter((one) => picks.of(one.id).size > 0)
    .map((one) => `${one.title} ${picks.of(one.id).size}개`)
    .join(' · ')
  const active = ext !== null && options.includes(ext) ? ext : null
  const visible = rows === undefined ? [] : filterByExtension(rows, active)

  return (
    <div className="ext-view">
      {/* 위쪽에는 **표에만 딸리는 것**만 남는다. 명령은 전부 아래 고정 바와 헤더로 갔다
          (기획서 §3) — 성격이 다른 셋을 같은 크기로 늘어놓으면 무엇을 먼저 눌러야 하는지
          화면이 말해 주지 않는다. */}
      {view?.kind === 'table' && (
        <div className="ext-view__commands">
          <button
            type="button"
            className="ext-command"
            disabled={visible.length === 0}
            title={t('보고 있는 그대로 저장합니다 (거른 것·정렬한 것 반영)')}
            onClick={() => exportRowsCsv({ title: view?.title ?? target.title, rows: visible, sort, onNotice })}
          >
            {t('CSV 로 내보내기')}
          </button>
        </div>
      )}

      <ExtensionViewTabs views={tabViews} activeId={viewId} onPick={setActiveViewId} count={countOf} />

      <ExtensionTabActions
        commands={tabCommands}
        running={props.running}
        onRun={(commandId) => void runAndShow(commandId)}
      />

      {/* **여기가 스크롤 칸이다.** 사이드바 본문(`.dc-sidebar__body`)에 맡기면 아래 고정 바가
          트리 길이를 따라다닌다 — 트리가 8줄일 때 바 아래로 221px 이 비었다 (실측).
          바깥을 스크롤 칸으로 두면 sticky 가 「넘칠 때만」 발동해서 그렇다. */}
      <div className="ext-view__scroll">
        {view === undefined ? null : view.kind === 'tree' ? (
          // 고른 개수는 **아래 고정 바**가 말한다 — 실행 버튼 바로 옆이라, 무엇이 실려
          // 나가는지를 누르기 직전에 본다 (트리 위에 두면 긴 트리에서 스크롤에 밀린다)
          <ExtensionTreePane
            nodes={nodes}
            find={find}
            onFind={setFind}
            segment={segment}
            onSegment={setSegment}
            picked={picks.of(viewId)}
            onPickedChange={(picked) => picks.set(viewId, picked)}
            expanded={expanded.of(viewId)}
            onToggle={(id) => expanded.toggle(viewId, id)}
            onOpen={props.onOpenPath}
            // 줄의 「결과」 — **그 대상 하나만** 싣고, 끝나면 그 화면으로 데려간다
            onAction={(commandId, id) => void runAndShow(commandId, [id])}
          />
        ) : view.kind === 'html' ? (
          htmlByView[viewId] === undefined ? (
            <p className="ext-empty">
              {t('아직 실행하지 않았습니다.')}
              <br />
              <span className="ext-empty__hint">{t('위 버튼을 눌러 결과를 만듭니다.')}</span>
            </p>
          ) : (
            // 사이드바에서는 **그리지 않는다.** 폭이 모자라 분석 표가 잘린다 —
            // 명령은 여기서 걸고 결과는 오른쪽 본문 탭에서 본다 (`useOpenHtmlTab` 머리말).
            <p className="ext-empty">
              {t('결과를 오른쪽에 열었습니다.')}
              <br />
              <button type="button" className="ext-command" onClick={() => showOnRight(true)}>
                {t('다시 열기')}
              </button>
            </p>
          )
        ) : view.kind === 'table' ? (
          <ExtensionTablePane
            rows={rows}
            visible={visible}
            options={options}
            active={active}
            onExtChange={setExt}
            sort={sort}
            onSort={setSort}
            onOpenRow={props.onOpenRow}
          />
        ) : (
          // 아직 못 그리는 종류를 조용히 빼면 확장 개발자가 왜 안 나오는지 알 수 없다
          // (`ExtensionsPanel` 과 같은 규칙).
          <p className="ext-empty">
            {t('아직 그리지 못하는 화면입니다')} ({view.kind}).
          </p>
        )}
      </div>

      <ExtensionActionBar
        primary={slots.primary}
        menu={slots.menu}
        pickedText={pickedText === '' ? '' : `${pickedText} 골랐습니다`}
        running={props.running}
        progress={props.progressByExtension[target.extension.name] ?? null}
        lines={linesOf(props.progressLog, target.extension.name)}
        // **닫은 결과 탭을 되열 자리.** 위의 효과는 HTML 이 바뀔 때만 도므로, 탭을 닫아도
        // 내용이 그대로면 다시 열리지 않는다 — 내용이 바뀌기 전까지 되열 길이 없었다.
        // 앱에 되열기 버튼이 있기는 했지만 html 뷰 본문 안이고, 그 뷰는 위에서 탭에서
        // 빼므로(`tabViews`) 닿을 수가 없다. 여기서는 확장을 다시 돌리지 않는다 —
        // 마지막으로 받아 둔 HTML 을 그대로 다시 띄운다.
        onShowResult={htmlOfHtmlView === undefined ? null : () => showOnRight(true)}
        // 주 행동에는 고른 것을 싣고, `⋯` 안의 마무리 명령에도 같이 싣는다 —
        // 무엇을 실을지는 확장이 판단할 몫이고 앱이 가려 줄 근거가 없다.
        onRun={(commandId) => {
          const carried = picks.selection.length > 0 ? picks.selection : undefined
          void runAndShow(commandId, carried).then((ok) => {
            // **주 행동이 성공했을 때만 푼다.** 고른 것을 써 버리는 자리가 거기라서다.
            // `⋯` 의 마무리 명령(내보내기·초기화)은 고른 것을 안 쓰는데 풀면 무엇을
            // 눌렀든 선택이 사라지는 것으로 겪는다. 줄의 「결과」 버튼은 애초에 여기로
            // 안 온다 (`onAction` 이 자기 마디만 싣는다). 실패·중단에도 안 푼다 —
            // 그 선택이 곧 **다시 돌릴 대상**이다.
            if (ok && carried && commandId === slots.primary?.id) picks.clear()
          })
        }}
        onCancel={props.onCancel}
      />
    </div>
  )
}
