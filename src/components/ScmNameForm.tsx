import { useState } from 'react'

// 이름(또는 설명) 한 줄을 받아 넘기는 작은 폼. 브랜치 만들기·임시저장 저장·브랜치 칩
// 메뉴가 같은 것을 쓴다 — 세 자리가 다르게 물으면 같은 행동이 다르게 보인다.
//
// **`window.prompt` 를 쓰지 않는다.** Electron 은 renderer 의 `prompt()` 를 구현하지
// 않는다 — `window.confirm` 은 되지만 `prompt` 는 값을 못 받는다. 그래서 제자리 입력칸이다.

export interface ScmNameFormProps {
  /** 접혀 있을 때 보이는 버튼 글자 */
  label: string
  placeholder: string
  onSubmit: (value: string) => void
}

export function ScmNameForm({ label, placeholder, onSubmit }: ScmNameFormProps) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')

  if (!open) {
    return (
      <button type="button" className="scm-btn scm-btn--ghost" onClick={() => setOpen(true)}>
        {label}
      </button>
    )
  }

  return (
    <form
      className="scm-ref-form"
      onSubmit={(event) => {
        event.preventDefault()
        const trimmed = value.trim()
        // 빈 이름은 git 이 거절한다. 여기서 막으면 쓸데없는 오류 토스트가 안 뜬다.
        if (trimmed === '') return
        onSubmit(trimmed)
        setValue('')
        setOpen(false)
      }}
    >
      <input
        className="scm-filter__input"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        autoFocus
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false)
        }}
      />
      <button type="submit" className="scm-btn">
        확인
      </button>
    </form>
  )
}
