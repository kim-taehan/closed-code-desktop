import { useCallback, type Dispatch, type SetStateAction } from 'react'
import type { ExtensionUiTarget } from '../../shared/ipc/extensionUiBridge'
import type { ActiveTab, OpenFile } from './openFilesTypes'

// 웹뷰 탭(매니페스트 3판)을 **본문 탭**으로 여는 부분. `useOpenHtmlTab` 과 같은 자리·같은 이유로
// 갈라져 있다 — 탭 목록의 주인은 `useOpenFiles` 다.
//
// `useOpenHtmlTab` 과 다른 점이 핵심이다: 저쪽은 같은 키면 **내용을 갈아끼운다**(= 문서가 다시 뜬다).
// 이쪽은 내용이 없다. 이미 열려 있으면 **그 탭으로 가기만** 한다 — 앞단은 살아 있는 채로 둔다.

/**
 * 웹뷰 탭의 식별자.
 *
 * 파일 경로·`ext:`(2판 HTML 탭)·`git:` 과 섞이지 않게 접두사를 따로 둔다. 확장 이름과 뷰 id 는
 * 남의 문자열이라 `:` 로 이으면 어디서 갈리는지 모른다 — JSON 으로 잇는다.
 * 프로젝트는 키에 넣지 않는다: 프로젝트를 옮기면 본문 탭이 통째로 비워진다 (`useOpenFiles`).
 */
export function webviewTabKey(extension: string, viewId: string): string {
  return `webview:${JSON.stringify([extension, viewId])}`
}

export function useOpenWebviewTab(
  setFiles: Dispatch<SetStateAction<OpenFile[]>>,
  setActive: Dispatch<SetStateAction<ActiveTab>>,
): (target: ExtensionUiTarget, label: string) => void {
  return useCallback(
    (target, label) => {
      const key = webviewTabKey(target.extension, target.viewId)
      // 이미 있으면 **손대지 않는다** — 객체를 새로 만들면 그리는 쪽이 탭이 바뀐 줄 안다
      setFiles((current) =>
        current.some((file) => file.path === key) ? current : [...current, { path: key, text: '', label, webview: target }],
      )
      setActive(key)
    },
    [setFiles, setActive],
  )
}
