import type { ExtensionView } from '../../shared/extensions/manifest'

// 확장 패널 안에서 **뷰를 가르는 탭**.
//
// 선택기(`SidebarPanelSelect`)가 확장을 고르고, 이 줄이 그 확장의 뷰를 고른다.
// 뷰마다 선택기 항목을 만들면 확장 하나가 목록을 여러 줄 차지한다 (`extensionPanels.ts`).
//
// 뷰가 하나뿐이면 **그리지 않는다** — 고를 것이 없는 탭 줄은 자리만 먹는다.
// 사이드바 폭(약 300px)에 긴 제목 셋이 안 들어가므로 **줄바꿈**한다. 가로 스크롤로 두면
// 뒤쪽 탭이 있는지조차 보이지 않는다.

/** 좁힌 뒤 몇 개 / 원래 몇 개. */
export interface TabCount {
  shown: number
  total: number
}

export interface ExtensionViewTabsProps {
  views: ExtensionView[]
  activeId: string
  onPick: (viewId: string) => void
  /**
   * 뷰 id → 그 탭에 **몇 개가 있나**. 고른 개수가 아니다 — 고른 것은 탭을 넘나들며
   * 쌓이므로 탭마다 나누어 보여주면 합계를 사람이 암산해야 한다 (그 한 줄은 아래 바에 있다).
   *
   * **좁히면 `24/280` 꼴이 된다.** 좁히기는 지금 보는 탭에만 걸리는 것이 아니라 모든 탭에
   * 같이 걸리는데, 예전에는 배지가 전체 수 그대로여서 「`controller` 로 좁혔더니 API 탭은
   * 0건」 같은 사실이 아무 데도 안 보였다 (`_workspace/87_explore` §3-4).
   *
   * `undefined` 는 "아직 안 돌렸다" 라 아무것도 안 붙인다. `0` 은 "돌렸는데 없다" 이므로 붙인다.
   */
  count: (viewId: string) => TabCount | undefined
}

export function ExtensionViewTabs({ views, activeId, onPick, count }: ExtensionViewTabsProps) {
  if (views.length < 2) return null

  return (
    <div className="ext-tabs" role="tablist">
      {views.map((view) => {
        const total = count(view.id)
        return (
          <button
            key={view.id}
            type="button"
            role="tab"
            aria-selected={view.id === activeId}
            className={`ext-tab${view.id === activeId ? ' ext-tab--active' : ''}`}
            onClick={() => onPick(view.id)}
          >
            {/* 제목은 매니페스트의 것이라 번역하지 않는다 */}
            {view.title}
            {total !== undefined && (
              // 안 좁혔으면 숫자 하나만 — 늘 `280/280` 이면 슬래시가 뜻을 잃는다
              <span className="ext-tab__count">
                {total.shown === total.total ? total.total : `${total.shown}/${total.total}`}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
