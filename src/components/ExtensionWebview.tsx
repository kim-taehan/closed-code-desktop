import { useEffect, useRef, useState } from 'react'
import { describeError } from '../../shared/errors/describeError'
import { checkUiMessage } from '../../shared/extensions/uiMessage'
import type { ExtensionUiMessagePayload, ExtensionUiTarget } from '../../shared/ipc/extensionUiBridge'
import { readPalette } from '../state/extensionHtmlDoc'
import { rejectedMessage, themeMessage, WebviewOutbox } from '../state/extensionWebviewPort'
import { t } from '../i18n/messages'

// 웹뷰 탭 하나 (매니페스트 3판, 확장 재설계 §2-1). 확장 패키지의 `ui/` 를 **한 번** 띄우고
// 그 뒤로는 메시지만 오간다.
//
// `ExtensionHtmlView`(2판)와 무엇이 다른가: 저쪽은 내용·테마가 바뀔 때마다 문서를 새로 등록해
// 새 URL 로 갈아끼웠다 — 그것이 「계속 다시 그린다」였다. 여기서 URL(=토큰)을 받는 것은
// **마운트할 때 한 번**뿐이다. 이 컴포넌트는 탭이 열려 있는 동안 내려지지 않고
// (`ExtensionWebviewStack` 이 CSS 로 감춘다), 닫히면 토큰을 놓는다.
//
// 격리는 같다: `sandbox="allow-scripts"`(allow-same-origin 없음) + 응답 헤더 CSP (`uiServer.ts`).
// 받는 메시지는 **이 iframe 이 보낸 것만**이다 — 문서가 opaque origin 이라 보내는 쪽이
// targetOrigin 을 특정할 수 없고(`'*'`), 그 검사가 이쪽에만 있다.

type Source =
  | { state: 'loading' }
  | { state: 'ready'; url: string; token: string }
  | { state: 'failed'; reason: string }

export function ExtensionWebview({ target }: { target: ExtensionUiTarget }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const tokenRef = useRef<string | null>(null)
  const outbox = useRef(new WebviewOutbox())
  /** 토큰이 오기 전에 온 뒷단 메시지 (아래 구독 머리말) */
  const beforeToken = useRef<ExtensionUiMessagePayload[] | null>([])
  const [source, setSource] = useState<Source>({ state: 'loading' })
  const { extension, viewId, projectId } = target

  // **한 번.** 의존성은 탭의 정체(확장·뷰·프로젝트)뿐이다 — 테마·메시지가 여기 끼면 그때마다
  // 토큰이 새로 나와 문서가 다시 뜬다. 내려질 때 토큰을 놓는다 (그 뒤로 그 토큰의 파일은 404).
  useEffect(() => {
    let alive = true
    let token: string | null = null
    void window.davis
      .openExtensionUi({ extension, viewId, projectId })
      .then((result) => {
        if (!result.ok) {
          beforeToken.current = null
          if (alive) setSource({ state: 'failed', reason: result.reason })
          return
        }
        token = result.token
        if (!alive) return void window.davis.closeExtensionUi({ token: result.token })
        // 토큰 전에 온 것 중 **내 것만** 붙잡아 둔 줄로 옮긴다. 남의 것은 여기서 버린다
        const held = beforeToken.current ?? []
        beforeToken.current = null
        tokenRef.current = result.token
        for (const payload of held) if (payload.token === result.token) outbox.current.push(payload.message)
        setSource({ state: 'ready', url: result.url, token: result.token })
      })
      .catch((error: unknown) => {
        beforeToken.current = null
        if (alive) setSource({ state: 'failed', reason: describeError(error) })
      })
    const box = outbox.current
    return () => {
      alive = false
      box.close()
      if (token !== null) void window.davis.closeExtensionUi({ token })
    }
  }, [extension, viewId, projectId])

  const token = source.state === 'ready' ? source.token : null

  // 뒷단이 민 것 — **자기 토큰의 것만.** 같은 확장·같은 뷰가 다른 프로젝트에 열려 있어도
  // 토큰이 다르다 (main 이 이미 골라 보내지만, 받는 쪽도 거른다 — 두 겹).
  // `load` 전이면 쌓아 둔다 (`WebviewOutbox`).
  //
  // **토큰을 알기 전부터 듣는다** (2026-09-22 실 Electron 실측). main 은 토큰을 내자마자 그 탭으로
  // 밀 수 있는데, 그 push 가 `openExtensionUi` 의 답보다 **먼저** 도착했다 — 토큰을 안 뒤에 구독하면
  // 그 한 통이 조용히 사라지고 `code.ui.post` 는 `true` 를 돌려준다. 그 사이 온 것은 전부 들고 있다가
  // 토큰이 오면 내 것만 남긴다.
  useEffect(
    () =>
      window.davis.onExtensionUiMessage((payload) => {
        if (tokenRef.current === null) beforeToken.current?.push(payload)
        else if (payload.token === tokenRef.current) outbox.current.push(payload.message)
      }),
    [],
  )

  // 테마를 바꾸면 `:root` 의 `data-theme` 이 바뀐다. **문서를 다시 만들지 않고** 알리기만 한다 (E6).
  // 아직 `load` 전이면 보내지 않는다 — `load` 때 그 순간의 테마가 간다.
  useEffect(() => {
    if (typeof MutationObserver !== 'function') return
    const root = document.documentElement
    const observer = new MutationObserver(() => {
      if (outbox.current.isOpen) outbox.current.push(themeMessage(readPalette(root)))
    })
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  // 앞단이 올린 것 — **이 iframe 이 보낸 것만.** 모양·크기를 여기서 먼저 보고, 못 건네면
  // 사유를 앞단에 돌려준다 (`__app:rejected`). postMessage 는 답이 없는 통로라 이것이 없으면
  // 확장 개발자는 왜 안 되는지 알 길이 없다.
  useEffect(() => {
    if (token === null) return
    const reject = (reason: string) => frame.current?.contentWindow?.postMessage(rejectedMessage(reason), '*')
    const handle = (event: MessageEvent): void => {
      if (event.source === null || event.source !== frame.current?.contentWindow) return
      const checked = checkUiMessage(event.data)
      if (!checked.ok) return reject(checked.reason)
      window.davis
        .sendExtensionUi({ token, message: event.data })
        .catch((error: unknown) => reject(describeError(error)))
    }
    window.addEventListener('message', handle)
    return () => window.removeEventListener('message', handle)
  }, [token])

  if (source.state === 'failed') {
    return <p className="ext-empty">{t('확장 화면을 띄우지 못했습니다')}: {source.reason}</p>
  }
  if (source.state === 'loading') {
    return <p className="ext-empty">{t('화면을 준비하는 중…')}</p>
  }

  return (
    <iframe
      ref={frame}
      className="ext-webview__frame"
      title={t('확장 화면')}
      // `allow-same-origin` 을 **주지 않는다** — 주는 순간 격리가 사라진다
      sandbox="allow-scripts"
      src={source.url}
      onLoad={() => {
        const target = frame.current?.contentWindow
        if (!target) return
        outbox.current.open((message) => target.postMessage(message, '*'), [
          themeMessage(readPalette(document.documentElement)),
        ])
      }}
    />
  )
}
