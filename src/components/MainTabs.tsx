import { isDirty, type ActiveTab, type OpenFile } from '../state/useOpenFiles'
import { SCM_TAB } from '../state/useScmView'

// 본문 탭 — 대화가 기본이고 연 파일이 옆에 붙는다.
//
// 프로젝트 탭(최상위)과 다른 것이다. 이쪽은 **한 프로젝트 안에서** 무엇을 볼지 고른다.

export interface MainTabsProps {
  files: OpenFile[]
  active: ActiveTab
  onSelect: (tab: ActiveTab) => void
  onClose: (path: string) => void
  /**
   * 넘칠 때 좌우로 옮기는 쪽이 잡는 스크롤 컨테이너 (`useTabStripScroll`).
   * 이 컴포넌트는 스크롤 상태를 쥐지 않는다 — 화살표는 줄 **바깥**에 있어야 안 잘린다.
   */
  scrollRef?: React.RefObject<HTMLDivElement | null>
  /**
   * 파일 탭을 우클릭했을 때. 좌표는 화면 기준이다 (메뉴가 `position: fixed`).
   * 대화·로그·소스 관리 탭에는 걸지 않는다 — 닫기 갈래가 없거나 하나뿐이다.
   */
  onContextMenu?: (path: string, x: number, y: number) => void
  /** 로그를 열어 뒀는지. 파일과 같은 층의 탭으로 선다. */
  logs: boolean
  onCloseLogs: () => void
  /** 소스 관리를 열어 뒀는지. 로그와 같은 층이다. */
  scm?: boolean
  onCloseScm?: () => void
}

export function MainTabs({
  files,
  active,
  onSelect,
  onClose,
  logs,
  onCloseLogs,
  scm,
  onCloseScm,
  scrollRef,
  onContextMenu,
}: MainTabsProps) {
  // 대화 탭은 파일이 없어도 늘 보인다 — 지금 무엇을 보고 있는지가 항상 드러나야 한다
  return (
    <div className="main-tabs" role="tablist" aria-label="본문 탭" ref={scrollRef}>
      <button
        type="button"
        role="tab"
        aria-selected={active === 'chat'}
        className={`main-tab${active === 'chat' ? ' main-tab--active' : ''}`}
        onClick={() => onSelect('chat')}
      >
        대화
      </button>

      {files.map((file) => (
        <span
          key={file.path}
          className={`main-tab${active === file.path ? ' main-tab--active' : ''}`}
          title={file.path}
          // 라벨 밖 여백을 눌러도 전환한다. 자식(라벨·×)에서 버블된 클릭은 제외 —
          // × 클릭까지 전환으로 받으면 닫히는 탭을 활성화하게 된다.
          onClick={(event) => {
            if (event.target === event.currentTarget) onSelect(file.path)
          }}
          // 탭 어디를 눌러도 (라벨·× 위에서도) 같은 메뉴가 뜬다 — 우클릭 대상은 탭 전체다
          onContextMenu={(event) => {
            if (onContextMenu === undefined) return
            // OS 기본 메뉴를 막지 않으면 그 위에 두 겹으로 뜬다
            event.preventDefault()
            onContextMenu(file.path, event.clientX, event.clientY)
          }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={active === file.path}
            className="main-tab__label"
            onClick={() => onSelect(file.path)}
          >
            {isDirty(file) && (
              <span className="main-tab__dirty" aria-label="저장 안 됨" title="저장 안 됨">
                ●
              </span>
            )}
            {file.label ?? baseName(file.path)}
          </button>
          <button
            type="button"
            className="main-tab__close"
            title="닫기"
            onClick={() => onClose(file.path)}
          >
            ×
          </button>
        </span>
      ))}

      {logs && (
        <span
          className={`main-tab${active === 'logs' ? ' main-tab--active' : ''}`}
          onClick={(event) => {
            if (event.target === event.currentTarget) onSelect('logs')
          }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={active === 'logs'}
            className="main-tab__label"
            onClick={() => onSelect('logs')}
          >
            로그
          </button>
          <button type="button" className="main-tab__close" title="닫기" onClick={onCloseLogs}>
            ×
          </button>
        </span>
      )}

      {scm && (
        <span
          className={`main-tab${active === SCM_TAB ? ' main-tab--active' : ''}`}
          onClick={(event) => {
            if (event.target === event.currentTarget) onSelect(SCM_TAB)
          }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={active === SCM_TAB}
            className="main-tab__label"
            onClick={() => onSelect(SCM_TAB)}
          >
            ⎇ 소스 관리
          </button>
          <button type="button" className="main-tab__close" title="닫기" onClick={onCloseScm}>
            ×
          </button>
        </span>
      )}
    </div>
  )
}

function baseName(path: string): string {
  return path.split('/').pop() ?? path
}
