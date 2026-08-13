import { useEffect, useRef, useState } from 'react'
import {
  extensionHtmlDoc,
  isCommandRequest,
  isOpenRequest,
  readPalette,
  type ExtensionHtmlPalette,
} from '../state/extensionHtmlDoc'
import { t } from '../i18n/messages'

// 확장이 준 화면(`code.view.setHtml`)을 그린다.
//
// **격리 문서는 `extensionHtmlDoc.ts` 가 문자열로 만들고, 여기서는 그것을 main 에 등록해
// `code-ext://` URL 로 띄운다.** `srcdoc` 을 쓰지 않는 이유는 그 문서가 앱 CSP 를 물려받아
// 확장 화면의 스크립트가 통째로 죽기 때문이다 (`electron/extensions/viewHost.ts` 머리말).
//
// 판정(무엇이 열기 요청인가)은 순수 함수로 빼 뒀다 — 창 객체 없이 시험할 수 있다.

export interface ExtensionHtmlViewProps {
  html: string
  /** 확장 화면이 `data-open` 으로 요청한 파일 열기. 규약을 안 쓰면 영영 안 불린다. */
  onOpen: (path: string, line?: number) => void
  /**
   * 확장 화면이 `data-command` 로 요청한 명령. 규약을 안 쓰면 영영 안 불린다.
   *
   * **주인 확인은 여기서 안 한다.** 이 컴포넌트는 자기 탭이 누구 것인지 모르고,
   * 안다 해도 화면에서 거르는 것은 방어가 아니다 — 확인은 명령표를 쥔 자식이 한다
   * (`electron/extensions/childHandlers.ts`). 여기는 부르는 쪽에 그대로 올린다.
   */
  onCommand?: (commandId: string) => void
}

/** 등록 결과. 실패를 `null` 로 뭉뚱그리지 않는다 — 준비 중과 실패가 같아 보이면 안 된다. */
type Source = { state: 'loading' } | { state: 'ready'; url: string } | { state: 'failed'; reason: string }

export function ExtensionHtmlView({ html, onOpen, onCommand }: ExtensionHtmlViewProps) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [palette, setPalette] = useState<ExtensionHtmlPalette>(() =>
    readPalette(typeof document === 'undefined' ? null : document.documentElement),
  )
  const [source, setSource] = useState<Source>({ state: 'loading' })

  // 테마를 바꾸면 `:root` 의 `data-theme` 이 바뀐다. iframe 은 별개 문서라 저절로 안 따라오므로
  // 여기서 색을 다시 읽어 문서를 새로 만든다 — 안 하면 확장 화면만 옛 테마로 남는다.
  useEffect(() => {
    if (typeof MutationObserver !== 'function') return
    const root = document.documentElement
    const observer = new MutationObserver(() => setPalette(readPalette(root)))
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  // 내용이나 테마가 바뀌면 **새 URL 을 받는다.** 같은 URL 을 재사용하면 브라우저가 캐시된
  // 문서를 그대로 보여줘 명령을 다시 돌려도 화면이 안 바뀐다 (`ExtensionViewHost.register`).
  useEffect(() => {
    let alive = true
    setSource({ state: 'loading' })
    void window.davis
      .registerExtensionView({ doc: extensionHtmlDoc(html, { palette }) })
      .then((result) => {
        if (alive) setSource({ state: 'ready', url: result.url })
      })
      .catch((error: unknown) => {
        // 조용히 빈 화면으로 두면 "확장이 아무것도 안 냈다" 와 구분되지 않는다
        if (alive) setSource({ state: 'failed', reason: error instanceof Error ? error.message : String(error) })
      })
    return () => {
      alive = false
    }
  }, [html, palette])

  // 다리가 보낸 것을 받는다 (열기·명령). **보낸 것이 이 iframe 인지 먼저 확인한다** —
  // 문서가 opaque origin 이라 보내는 쪽이 targetOrigin 을 특정할 수 없고(`'*'`),
  // 그 검사가 이쪽에만 있다.
  useEffect(() => {
    const handle = (event: MessageEvent): void => {
      if (event.source !== frame.current?.contentWindow) return
      if (isOpenRequest(event.data)) {
        onOpen(event.data.path, event.data.line)
        return
      }
      if (isCommandRequest(event.data)) onCommand?.(event.data.commandId)
    }
    window.addEventListener('message', handle)
    return () => window.removeEventListener('message', handle)
  }, [onOpen, onCommand])

  if (source.state === 'failed') {
    return <p className="ext-empty">{t('확장 화면을 띄우지 못했습니다')}: {source.reason}</p>
  }
  if (source.state === 'loading') {
    return <p className="ext-empty">{t('화면을 준비하는 중…')}</p>
  }

  return (
    <iframe
      ref={frame}
      className="ext-html"
      title={t('확장 화면')}
      // `allow-same-origin` 을 **주지 않는다** — 주는 순간 격리가 사라진다
      // (`extensionHtmlDoc.ts` 머리말 1번).
      sandbox="allow-scripts"
      src={source.url}
    />
  )
}
