import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react'
import type { ActiveTab, OpenFile } from './useOpenFiles'

// 확장이 만든 화면(`davis.view.setHtml`)을 **본문 탭**으로 여는 부분.
// `useOpenDiffTab` 과 같은 자리·같은 이유로 갈라져 있다 — 탭 목록의 주인은 `useOpenFiles` 다.
//
// 왜 본문 탭인가: 사이드바 폭(약 300px)에는 분석 표가 안 들어간다. 실측 산출물 01 의 칸이
// 12개인데 셋만 겨우 들어가 경로·요약이 통째로 빠진다 (`_workspace/84_mock` §폭 문제).
// 그래서 **명령은 왼쪽에서 걸고 결과는 오른쪽에서 본다.**
//
// 호스트는 **어느 확장인지 모른다.** 여기 오는 것은 키·이름표·HTML 문자열뿐이고,
// 그리는 일은 `OpenTab → ExtensionHtmlView` 가 격리해서 한다.

/**
 * 확장 화면 탭의 식별자.
 *
 * 파일 경로와 섞이면 안 된다 — 탭을 닫거나 고를 때 같은 목록에서 찾으므로, 확장 뷰 id 가
 * 우연히 파일 경로처럼 생기면 엉뚱한 탭을 건드린다. git diff 가 `git:` 접두사를 쓰는 것과
 * 같은 이유다 (`diffTabKey`).
 */
export function htmlTabKey(extensionName: string, viewId: string): string {
  return `ext:${extensionName}:${viewId}`
}

/**
 * 확장 화면을 연다. 같은 뷰가 이미 열려 있으면 **내용만 갈아끼운다.**
 *
 * 갈아끼우는 이유: 명령을 다시 돌리면 결과가 통째로 바뀌는데(`setHtml` 은 이어붙이기가
 * 아니다), 탭을 새로 만들면 낡은 화면이 옆에 남아 어느 것이 최신인지 알 수 없다.
 *
 * **밀려온 갱신은 앞으로 끌어오지 않는다** (처음 열 때 한 번만). 예전에는 밀어 올릴 때마다
 * 골랐는데, 확장이 **진행 상황을 몇 초마다 밀기** 시작하면서 그 자리가 함정이 됐다 —
 * 사용자가 다른 파일을 보려고 탭을 옮겨도 다음 갱신이 곧바로 도로 끌어온다. 수 분짜리 작업
 * 내내 다른 파일을 볼 수 없다는 뜻이다.
 *
 * **사람이 눌러서 여는 것은 다르다** (`focus`). 「결과」를 누르는 것은 *그 화면으로 가겠다*는
 * 말인데, 위의 방어가 그것까지 막아 **눌러도 아무 데도 안 가는** 자리가 됐었다
 * (실측 불만: *"테스트 시나리오는 나오는데 그 화면으로 이동되지는 않네"*).
 * 가르는 것은 부르는 쪽이다 — 여기서는 밀린 것인지 눌린 것인지 알 수 없다.
 */
export function useOpenHtmlTab(
  setFiles: Dispatch<SetStateAction<OpenFile[]>>,
  setActive: Dispatch<SetStateAction<ActiveTab>>,
): (key: string, label: string, html: string, focus?: boolean) => void {
  /**
   * 이 창에서 **한 번이라도 연** 확장 화면 키.
   *
   * 상태가 아니라 ref 인 이유: 이 함수의 정체성이 흔들리면 안 된다. 부르는 쪽
   * (`ExtensionViewPanel`)이 이것을 의존성으로 둔 효과에서 부르므로, 렌더마다 새 함수가
   * 되면 **효과가 매번 다시 돌아 화면을 끝없이 다시 민다.**
   *
   * 사용자가 탭을 닫아도 지우지 않는다 — 닫은 뒤 갱신이 오면 탭은 조용히 돌아오되
   * 앞으로 끌려 나오지는 않는다. 닫은 것은 「그만 보겠다」는 뜻이지 「다시 데려와라」가 아니다.
   */
  const opened = useRef(new Set<string>())

  return useCallback(
    (key, label, html, focus) => {
      setFiles((current) =>
        current.some((file) => file.path === key)
          ? current.map((file) => (file.path === key ? { ...file, html, label } : file))
          : [...current, { path: key, text: '', label, html }],
      )
      // 눌러서 연 것은 **늘** 앞으로 온다. 밀려온 갱신은 처음 한 번만
      if (focus !== true && opened.current.has(key)) return
      opened.current.add(key)
      setActive(key)
    },
    [setFiles, setActive],
  )
}
