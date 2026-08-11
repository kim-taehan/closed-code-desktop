import { useEffect, useState } from 'react'
import type { ExtensionAskTextPayload } from '../../shared/ipc/channels'
import { t } from '../i18n/messages'

// 확장이 사람에게 글을 묻는 창 (`davis.ui.askText`).
//
// **모양은 앱이 정한다.** 확장은 무엇을 묻는지만 말하고 HTML 을 주지 못한다 —
// 확장 화면(`davis-ext://`)은 iframe sandbox 안에 가둬 두는데, 물음창까지 확장이 그리게
// 하면 그 울타리가 무의미해진다 (표준 §4.2).
//
// **어느 확장이 묻는지 반드시 보인다.** 익명으로 뜨는 입력창은 사용자가 무엇에 답하는지
// 모른 채 값을 넣게 한다 — 배포처로 남의 확장을 받기 시작하면 그대로 위험이 된다.
//
// 껍데기는 `dc-modal` 을 그대로 쓴다 (`ApprovalModal` 과 같은 자리). 답하지 않으면 확장의
// `await` 가 걸려 있으므로 **닫는 길을 반드시 남긴다** — Esc 와 취소, 둘 다 `null` 이다.

export interface ExtensionAskTextProps {
  request: ExtensionAskTextPayload
  /** 취소면 `null` */
  onRespond: (text: string | null) => void
}

export function ExtensionAskText({ request, onRespond }: ExtensionAskTextProps) {
  const [text, setText] = useState(request.value)

  // 물음이 바뀌면 상자를 갈아 끼운다 — 창은 하나뿐이라 물음이 잇달으면 실제로 갈린다.
  // 앞 물음의 답이 남아 있으면 사용자가 그것을 이번 답으로 보낸다.
  useEffect(() => setText(request.value), [request.requestId, request.value])

  const field = {
    className: 'ext-ask__field',
    value: text,
    autoFocus: true,
    'aria-label': request.title,
    onChange: (event: { target: { value: string } }) => setText(event.target.value),
  }

  return (
    <div className="dc-modal" role="dialog" aria-modal="true" aria-label={request.title}>
      <div
        // 여러 줄은 **넓혀야 한다.** 440px 에서는 유형 줄("정상 · 필수값 누락 · …")과
        // 수행절차가 접혀, 사용자가 자기가 쓴 글의 모양을 못 본다 — 본보기는 모양이 내용이다.
        className={`dc-modal__card${request.multiline ? ' dc-modal__card--wide' : ''}`}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onRespond(null)
          // 여러 줄 상자에서 Enter 는 줄바꿈이다 — 보내기는 ⌘/Ctrl+Enter
          if (event.key === 'Enter' && (!request.multiline || event.metaKey || event.ctrlKey)) onRespond(text)
        }}
      >
        <div className="dc-modal__head">
          <span className="dc-modal__title">{request.title}</span>
          {/* 누가 묻는지 — 제목보다 작게, 그러나 늘 있다 */}
          <span className="ext-ask__who">{request.extension}</span>
        </div>

        {request.hint !== undefined && <p className="ext-ask__hint">{request.hint}</p>}

        {request.multiline ? <textarea {...field} rows={14} /> : <input type="text" {...field} />}

        <div className="dc-modal__actions">
          <button type="button" className="dc-modal__close" onClick={() => onRespond(null)}>
            {t('취소')}
          </button>
          <button type="button" className="ext-ask__ok" onClick={() => onRespond(text)}>
            {t('저장')}
          </button>
        </div>
      </div>
    </div>
  )
}
