import { useState } from 'react'

// 파일 트리가 이름을 묻는 창 (새 파일·새 폴더·이름 변경).
//
// 껍데기는 `dc-modal` 을 그대로 쓴다 — `ExtensionAskText`·`ApprovalModal` 과 같은 자리다.
// 그쪽을 재사용하지 않는 이유는 **누가 묻는지**가 다르기 때문이다: 확장 물음창은
// 「어느 확장이 묻나」를 반드시 보이는데(익명 입력창을 두지 않는다), 이 창은 앱이 묻는다.
//
// **닫는 길을 반드시 남긴다** — Esc 와 취소. 이름을 못 정했을 때 갇히면 안 된다.

export interface FileTreePromptProps {
  title: string
  /** 어디에 생기는지·무엇을 바꾸는지. 제목만으로는 대상이 안 보인다 */
  hint: string
  /** 처음 채워 둘 값. 이름 변경은 지금 이름이 들어온다 — 고쳐 쓰는 것이 기본 사용이다 */
  value: string
  /** 취소면 `null` */
  onDone: (name: string | null) => void
}

export function FileTreePrompt({ title, hint, value, onDone }: FileTreePromptProps) {
  const [text, setText] = useState(value)
  const name = text.trim()

  return (
    <div className="dc-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div
        className="dc-modal__card"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onDone(null)
          // 빈 이름으로는 못 보낸다. 막지 않으면 main 이 거절하는데, 그 거절이 토스트로
          // 오므로 사용자는 **창이 닫힌 뒤에** 실패를 안다.
          if (event.key === 'Enter' && name !== '') onDone(name)
        }}
      >
        <div className="dc-modal__head">
          <span className="dc-modal__title">{title}</span>
        </div>

        <p className="ext-ask__hint">{hint}</p>

        <input
          type="text"
          className="ext-ask__field"
          value={text}
          autoFocus
          aria-label={title}
          onChange={(event) => setText(event.target.value)}
        />

        <div className="dc-modal__actions">
          <button type="button" className="dc-modal__btn" onClick={() => onDone(null)}>
            취소
          </button>
          <button type="button" className="ext-ask__ok" disabled={name === ''} onClick={() => onDone(name)}>
            확인
          </button>
        </div>
      </div>
    </div>
  )
}
