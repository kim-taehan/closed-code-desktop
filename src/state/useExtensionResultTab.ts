import { useCallback, useEffect } from 'react'
import { htmlTabKey } from './useOpenHtmlTab'
import type { ExtensionView } from '../../shared/extensions/manifest'

// 확장의 **결과 화면(`kind: 'html'`)을 본문 탭에 띄우는 규칙.**
//
// `ExtensionViewPanel` 에서 갈라냈다 — 저쪽이 300줄 상한에 닿았다. 규칙이 셋인데
// 셋 다 실측으로 얻은 것이라 함께 둔다.

export function useExtensionResultTab(args: {
  /** 그 확장이 선언한 뷰 전부. 이 중 `kind: 'html'` 하나가 결과 화면이다 */
  views: ExtensionView[]
  htmlByView: Record<string, string | undefined>
  /** 그 탭의 주인. `data-command` 로 온 명령을 이 확장에게만 보내는 근거가 된다 */
  extension: string
  onOpenHtml: (key: string, label: string, html: string, focus?: boolean, extension?: string) => void
}): { show: (focus?: boolean) => void; ready: boolean } {
  const { views, htmlByView, extension, onOpenHtml } = args

  // 결과 화면은 **탭과 무관하게** 오른쪽에 띄운다. 명령을 돌린 탭(API)에 머무는 것이
  // 보통이라, 보고 있는 탭이 결과 탭일 때만 열면 다 쓰고도 아무 변화가 없어 보인다.
  const htmlView = views.find((one) => one.kind === 'html')
  const html = htmlView === undefined ? undefined : htmlByView[htmlView.id]

  const showOnRight = useCallback(
    (focus = false) => {
      if (htmlView === undefined || html === undefined) return
      onOpenHtml(htmlTabKey(extension, htmlView.id), htmlView.title, html, focus, extension)
    },
    [htmlView, html, onOpenHtml, extension],
  )

  // 결과가 올라오면 **바로** 오른쪽에 띄운다. 한 번 더 누르게 하면, 명령을 돌린 뒤
  // 사이드바에 아무 변화가 없어 "안 먹었다" 로 보인다 (이 레포의 단골 실패).
  // **앞으로 끌어오지는 않는다** — 진행 갱신이 몇 초마다 오므로 그동안 다른 파일을 볼 수 없다.
  useEffect(() => {
    showOnRight()
  }, [showOnRight])

  // `ready` 는 **띄울 것이 이미 있는가**다. 닫은 탭을 되여는 버튼이 이것으로 갈린다 —
  // 없는데 버튼을 두면 눌러도 아무 일이 없다.
  return { show: showOnRight, ready: html !== undefined }
}
