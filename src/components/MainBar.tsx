import { useState } from 'react'
import { MainTabs } from './MainTabs'
import { MainTabMenu } from './MainTabMenu'
import type { OpenFilesApi } from '../state/useOpenFiles'
import { SCM_TAB } from '../state/useScmView'
import { useTabStripScroll } from '../state/useTabStripScroll'
import { tabCloseTargets } from '../state/tabCloseTargets'

// 본문 탭 줄.
//
// 화면 탭들만 산다.
//
// 프로젝트 이름은 **맨 위 레일이 이미 보여준다** — 여기 또 두면 같은 것이 두 줄에 겹친다.
// 이름 고치기·닫기도 이름을 따라 레일 칩으로 옮겼다.
//
// ⚙·파일 검색은 여기 없다. 둘 다 **앱 전역**이라 프로젝트·파일보다 위층이고,
// 맨 위 레일 오른쪽 끝이 그 자리다 (`ProjectRail`). 이 줄에 두면 파일 도구바
// (`18줄 · 미리보기`)와 나란히 놓여 파일 도구처럼 읽힌다.
//
// 로그는 파일과 같은 층의 탭이라 여기서 여닫는다. 열면 그 탭으로 옮겨 가고,
// 닫을 때 그 탭을 보고 있었으면 대화로 돌아간다.
//
// **화살표와 우클릭 메뉴는 탭 줄 바깥에 산다.** 줄은 `overflow-x: auto` 라 그 안에 두면
// 화살표가 같이 밀려 나가고 메뉴가 잘린다.

export interface MainBarProps {
  openFiles: OpenFilesApi
  logs: boolean
  onLogs: (open: boolean) => void
  /** 소스 관리 탭 — 로그와 같은 층, 같은 여닫이 규칙 */
  scm: boolean
  onScm: (open: boolean) => void
}

/** 우클릭한 탭과 메뉴가 뜰 자리 */
interface MenuAt {
  path: string
  x: number
  y: number
}

export function MainBar(props: MainBarProps) {
  const { openFiles, logs, onLogs, scm, onScm } = props
  const strip = useTabStripScroll(openFiles.active, openFiles.files.length)
  const [menu, setMenu] = useState<MenuAt | null>(null)

  return (
    <div className="main-bar">
      {/* 넘칠 때만 그린다 — 늘 두면 탭이 몇 개 없을 때 빈 화살표가 자리만 먹는다 */}
      {(strip.canLeft || strip.canRight) && (
        <button
          type="button"
          className="main-bar__arrow"
          title="왼쪽 탭 보기"
          aria-label="왼쪽 탭 보기"
          disabled={!strip.canLeft}
          onClick={() => strip.scrollBy(-1)}
        >
          ‹
        </button>
      )}

      <MainTabs
        files={openFiles.files}
        active={openFiles.active}
        onSelect={openFiles.select}
        onClose={openFiles.close}
        scrollRef={strip.ref}
        onContextMenu={(path, x, y) => setMenu({ path, x, y })}
        logs={logs}
        onCloseLogs={() => {
          onLogs(false)
          if (openFiles.active === 'logs') openFiles.select('chat')
        }}
        scm={scm}
        onCloseScm={() => {
          onScm(false)
          if (openFiles.active === SCM_TAB) openFiles.select('chat')
        }}
      />

      {(strip.canLeft || strip.canRight) && (
        <button
          type="button"
          className="main-bar__arrow"
          title="오른쪽 탭 보기"
          aria-label="오른쪽 탭 보기"
          disabled={!strip.canRight}
          onClick={() => strip.scrollBy(1)}
        >
          ›
        </button>
      )}

      {menu !== null && (
        <MainTabMenu
          x={menu.x}
          y={menu.y}
          // 메뉴가 열린 사이에 목록이 바뀔 수 있다 — **그릴 때마다** 지금 목록에서 다시 센다
          targets={tabCloseTargets(openFiles.files, menu.path)}
          onClose={openFiles.closeMany}
          onDismiss={() => setMenu(null)}
        />
      )}
    </div>
  )
}
