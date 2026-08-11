import { useState } from 'react'

// 커밋 입력칸. 패널 **맨 아래 고정**이다 — 파일이 많아도 커밋 버튼을 찾아 스크롤하지 않는다.
//
// 커밋 시점에 따로 add 하지 않는다. 인덱스에 있는 것을 그대로 담는다 (설계 §3).

export interface GitCommitBoxProps {
  /** 인덱스에 담긴 것이 있는지. 없으면 커밋할 게 없다. */
  hasStaged: boolean
  /** 올릴 커밋이 있는지 (ahead > 0 또는 업스트림 없음). 푸시 버튼 활성 근거다. */
  canPush: boolean
  busy: boolean
  onCommit: (message: string) => void
  onPush: () => void
}

export function GitCommitBox({ hasStaged, canPush, busy, onCommit, onPush }: GitCommitBoxProps) {
  const [message, setMessage] = useState('')

  const canCommit = hasStaged && message.trim() !== '' && !busy

  function commit(): void {
    if (!canCommit) return
    onCommit(message.trim())
    setMessage('')
  }

  return (
    <div className="git-commit">
      <textarea
        className="git-commit__input"
        placeholder="커밋 메시지"
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        // Cmd/Ctrl+Enter 로 커밋 — 줄바꿈과 커밋을 가른다
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') commit()
        }}
        rows={2}
      />
      <div className="git-commit__actions">
        <button
          type="button"
          className="git-commit__button"
          disabled={!canCommit}
          onClick={commit}
        >
          커밋
        </button>
        <button
          type="button"
          className="git-commit__button"
          disabled={!canPush || busy}
          onClick={onPush}
        >
          푸시
        </button>
      </div>
    </div>
  )
}
