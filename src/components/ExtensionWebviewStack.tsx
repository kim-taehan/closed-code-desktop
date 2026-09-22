import type { OpenFile } from '../state/openFilesTypes'
import { ExtensionWebview } from './ExtensionWebview'
import '../styles/extensions.css'

// 열린 웹뷰 탭 **전부를** 늘 그려 둔다. 보이는 것은 지금 탭 하나고 나머지는 CSS 로 감춘다 (E4).
//
// 왜 다른 탭처럼 「지금 탭만 그리기」를 안 하나: 그러면 탭을 옮길 때마다 iframe 이 내려졌다
// 다시 올라가 **문서가 새로 뜬다** — 앞단의 스크롤·입력·상태가 날아가는, 없애려던 바로 그것이다.
// `display: none` 은 iframe 을 다시 싣지 않는다. 반대로 DOM 에서 **자리를 옮기면** 다시 싣는다 —
// 그래서 이 묶음은 `MainView` 안에서 늘 같은 자리에 있다 (갈래가 바뀌어도 형제 순서가 같다).
//
// 탭을 닫으면 목록에서 빠져 iframe 이 내려지고, 다시 열면 새로 뜬다 (확장 재설계 §2-1).

export function ExtensionWebviewStack({ files, active }: { files: OpenFile[]; active: string }) {
  return (
    <>
      {files.map((file) =>
        file.webview === undefined ? null : (
          <div
            // 탭 키가 곧 정체다 — 키가 흔들리면 React 가 iframe 을 새로 만든다
            key={file.path}
            className={`ext-webview${file.path === active ? '' : ' ext-webview--hidden'}`}
            data-tab={file.path}
          >
            <ExtensionWebview target={file.webview} />
          </div>
        ),
      )}
    </>
  )
}
