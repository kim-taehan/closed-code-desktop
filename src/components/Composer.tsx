import { useEffect, useRef, useState } from 'react'
import { MODE_HINT, detectComposerMode } from '../state/composerMode'
import { mentionAtCaret, replaceMention } from '../state/atMentions'
import { openArgAtCaret, replaceSlashContext, slashContextAtCaret } from '../state/composerMode'
import { findSlashCommand, type SlashChoice } from '../state/slashCommands'
import { wantsHistoryNav } from '../state/composerArrowKeys'
import { categoryInsertText } from '../state/slashNamespace'
import { useAutoGrow, useDoubleEscape } from './composerHooks'
import { MentionPopup } from './MentionPopup'
import { SlashPopup } from './SlashPopup'

// 채팅 입력창. 입력값은 컴포넌트 내부 상태로 둔다.
//
// 부모가 값을 들고 있으면 "전송 후 비우기"를 부모가 매번 기억해야 하는데,
// 비우는 시점은 전송 성공 여부와 무관하게 항상 같다. 그래서 내부에서 비우고
// 부모에겐 확정된 텍스트만 넘긴다 — 부모는 onSubmit 만 구현하면 된다.

/** 자동 확장 상한. 넘으면 textarea 자체가 스크롤된다 */
const MAX_HEIGHT_PX = 200

export interface ComposerProps {
  /** 전송 확정. 앞뒤 공백이 제거된 비어있지 않은 텍스트만 전달된다 */
  onSubmit: (text: string) => void
  /** 준비되지 않은 상태(연결 대기 등). 입력과 전송을 모두 막는다 */
  disabled?: boolean
  /**
   * 밖에서 끼워 넣을 텍스트. 값이 바뀔 때마다(nonce) 반영된다.
   * 기본은 현재 입력 뒤에 붙이기(파일 경로 등), replace 면 입력창을 통째로 채운다(대기열 되돌리기).
   */
  insert?: { text: string; nonce: number; replace?: boolean }
  /** 상자 안쪽 아래 줄. 왼쪽에 놓인다 (추가 버튼 등). */
  left?: React.ReactNode
  /** 상자 안쪽 아래 줄. 전송 버튼 앞에 놓인다 (모드 선택기 등). */
  right?: React.ReactNode
  /** 지금 보고 있는 문서. 보내면 함께 붙는다는 것을 알린다. */
  viewing?: string
  /** 위/아래로 되짚을 이전 입력. 최근 것이 앞(index 0). */
  history?: string[]
  /** 전송한 입력을 히스토리에 기록한다. */
  onHistoryRecord?: (text: string) => void
}

export function Composer({
  onSubmit,
  disabled = false,
  insert,
  left,
  right,
  viewing,
  history = [],
  onHistoryRecord,
}: ComposerProps) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mode = detectComposerMode(value)
  /** `@` 뒤에 치고 있는 것. null 이면 자동완성을 띄우지 않는다. */
  const [mention, setMention] = useState<string | null>(null)
  /** `/` 뒤에 치고 있는 스킬 이름 */
  const [slash, setSlash] = useState<string | null>(null)
  /** `/open ` 뒤에 치고 있는 파일 이름 토막. null 이면 인라인 파일 리스트를 띄우지 않는다. */
  const [openArg, setOpenArg] = useState<string | null>(null)
  /** 히스토리 탐색 위치. null 이면 탐색 중이 아니라 지금 쓰던 글을 든 상태다. */
  const [histIndex, setHistIndex] = useState<number | null>(null)
  /** 탐색을 시작하기 직전에 쓰던 글. 최신보다 아래로 내려오면 이걸 되돌린다. */
  const draftRef = useRef('')

  function syncMention(text: string, caret: number): void {
    const arg = openArgAtCaret(text, caret)
    setOpenArg(arg)
    // `/open @…` 처럼 인자 구간에서는 파일 리스트만 띄운다 — 두 팝업이 키를 나눠 먹으면 안 된다
    setMention(arg === null ? mentionAtCaret(text, caret) : null)
    setSlash(slashContextAtCaret(text, caret))
  }

  function pickSlash(choice: SlashChoice): void {
    // 카테고리는 `/이름 ` 만 넣고 항목 단계로 넘긴다 (DC-980 2단계).
    // 스킬은 `/스킬명` 을 넣어 두고 사용자가 이어 쓴다.
    // 인자를 받는 명령도 마찬가지로 `/이름 ` 을 넣어 두고, 전송 때 가로챈다.
    // 인자가 없는 명령은 고르는 즉시 실행하고 입력창을 비운다.
    if (choice.kind === 'category') {
      insertSlash(categoryInsertText(choice.namespace))
      return
    }
    if (choice.kind === 'skill') {
      insertSlash(`/${choice.name} `)
      return
    }
    if (choice.command.takesArgs) {
      // 2단계로 들어왔어도 canonical 한 단계 형태로 되돌린다 — 인자 구간·전송 가로채기 기준
      insertSlash(`/${choice.command.name} `)
      return
    }
    choice.command.run('')
    setValue('')
    setSlash(null)
    setHistIndex(null)
  }

  /**
   * 커서 앞의 `/` 맥락을 넣을 텍스트로 갈아끼우고 커서를 뒤로 옮긴다.
   *
   * 카테고리(`/command `)면 항목 단계로 이어지고, 항목(`/open `)이면 맥락이 닫힌다 —
   * 넣은 뒤 다시 읽으므로 어느 쪽인지 여기서 따질 필요가 없다.
   * `/open` 은 곧바로 파일 리스트로 이어지므로 인자 구간도 함께 다시 읽는다.
   */
  function insertSlash(insert: string): void {
    const element = textareaRef.current
    const caret = element?.selectionStart ?? value.length
    const next = replaceSlashContext(value, caret, insert)

    setValue(next.text)
    setSlash(slashContextAtCaret(next.text, next.caret))
    setOpenArg(openArgAtCaret(next.text, next.caret))
    requestAnimationFrame(() => element?.setSelectionRange(next.caret, next.caret))
  }

  /** `/open` 인라인 리스트에서 고른 파일을 연다. 명령이 실행됐으니 입력창은 비운다. */
  function pickOpenArg(path: string): void {
    findSlashCommand('open')?.run(path)
    setValue('')
    setOpenArg(null)
    setHistIndex(null)
  }

  function pickMention(path: string): void {
    const element = textareaRef.current
    const caret = element?.selectionStart ?? value.length
    const next = replaceMention(value, caret, path)

    setValue(next.text)
    setMention(null)
    setSlash(null)
    // 커서를 넣은 경로 뒤로 옮긴다 — 안 그러면 이어 치는 글자가 앞에 들어간다
    requestAnimationFrame(() => element?.setSelectionRange(next.caret, next.caret))
  }
  const handleEscape = useDoubleEscape(() => setValue(''))

  // nonce 로 감시한다 — 같은 파일을 두 번 고르면 text 는 그대로라 반응하지 않는다
  useEffect(() => {
    if (!insert || insert.text === '') return
    if (insert.replace) setValue(insert.text)
    else setValue((current) => (current === '' ? insert.text : `${current.trimEnd()} ${insert.text}`))
    setHistIndex(null)
    textareaRef.current?.focus()
  }, [insert?.nonce])

  useAutoGrow(textareaRef, value, MAX_HEIGHT_PX)

  function submit() {
    const text = value.trim()
    if (!text || disabled) return
    onHistoryRecord?.(text)
    setValue('')
    setHistIndex(null)
    onSubmit(text)
  }

  /** 값을 히스토리 항목으로 바꾸고 커서를 끝으로 보낸다. */
  function fillFromHistory(text: string): void {
    setValue(text)
    requestAnimationFrame(() => textareaRef.current?.setSelectionRange(text.length, text.length))
  }

  /**
   * 위/아래로 히스토리를 되짚는다. 처리했으면 true.
   *
   * 위는 **첫 줄에서만**, 아래는 **끝 줄에서만** 히스토리로 넘어간다 — 여러 줄을 쓰는
   * 중에 줄 사이를 오가는 평범한 커서 이동을 막지 않으려는 것이다. 선택 영역이 있으면
   * 편집으로 보고 넘긴다.
   */
  function navigateHistory(event: React.KeyboardEvent<HTMLTextAreaElement>): boolean {
    const element = textareaRef.current
    if (!element || element.selectionStart !== element.selectionEnd) return false
    const caret = element.selectionStart

    if (event.key === 'ArrowUp') {
      if (value.slice(0, caret).includes('\n')) return false
      if (history.length === 0) return false
      if (histIndex === null) draftRef.current = value
      const next = histIndex === null ? 0 : Math.min(histIndex + 1, history.length - 1)
      setHistIndex(next)
      fillFromHistory(history[next] ?? '')
      event.preventDefault()
      return true
    }

    // ArrowDown — 탐색 중일 때만 반응한다
    if (histIndex === null || value.slice(caret).includes('\n')) return false
    if (histIndex === 0) {
      setHistIndex(null)
      fillFromHistory(draftRef.current)
    } else {
      setHistIndex(histIndex - 1)
      fillFromHistory(history[histIndex - 1] ?? '')
    }
    event.preventDefault()
    return true
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // 이 화살표가 누구 것인지는 `composerArrowKeys` 가 정한다 — 자동완성 팝업(window capture
    // 리스너)과 셸 드로어(⌘↑/⌘↓)가 같은 키를 노리고, 그 판정이 한 곳에 있어야 한다.
    if (wantsHistoryNav(event, { mention, slash, openArg }) && navigateHistory(event)) return

    if (event.key === 'Escape') {
      // 빈 입력창을 지울 건 없다 — 카운트만 이어간다
      if (value !== '') handleEscape()
      return
    }

    // 한글·일본어 조합 확정 Enter 는 keydown 으로도 올라온다.
    // isComposing 을 보지 않으면 조합 확정이 전송으로 새어 나간다.
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      // Shift+Enter 는 줄바꿈 — 브라우저 기본 동작에 맡긴다
      if (event.shiftKey) {
        handleEscape.reset()
        return
      }
      event.preventDefault()
      submit()
      return
    }

    handleEscape.reset()
  }

  return (
    <div
      className={`composer${disabled ? ' composer--off' : ''}${mode ? ` composer--${mode}` : ''}`}
    >
      <textarea
        ref={textareaRef}
        rows={1}
        value={value}
        onChange={(event) => {
          setValue(event.target.value)
          // 직접 고치기 시작하면 히스토리 탐색에서 빠져나온다
          setHistIndex(null)
          syncMention(event.target.value, event.target.selectionStart ?? 0)
        }}
        onKeyUp={(event) => syncMention(value, event.currentTarget.selectionStart ?? 0)}
        onClick={(event) => syncMention(value, event.currentTarget.selectionStart ?? 0)}
        onBlur={() => {
          setMention(null)
          setSlash(null)
          setOpenArg(null)
        }}
        onKeyDown={onKeyDown}
        placeholder={disabled ? '연결을 기다리는 중…' : '메시지를 입력하세요…'}
        disabled={disabled}
        style={{ maxHeight: MAX_HEIGHT_PX, overflowY: 'auto', resize: 'none' }}
      />

      {mention !== null && (
        <MentionPopup query={mention} onPick={pickMention} onClose={() => setMention(null)} includeDirs />
      )}
      {/* `/open` 인자 구간 — 같은 파일 리스트를 재사용하되 고르면 넣는 대신 연다 */}
      {openArg !== null && (
        <MentionPopup query={openArg} onPick={pickOpenArg} onClose={() => setOpenArg(null)} label="파일 열기" />
      )}
      {slash !== null && (
        <SlashPopup query={slash} onPick={pickSlash} onClose={() => setSlash(null)} />
      )}

      {/* 조작 줄은 상자 **안쪽**에 있다. 입력창이 늘어나도 이 줄은 그대로다. */}
      <div className="composer__tools">
        <div className="composer__slot">
          {left}
          {/* 무엇을 받고 있는지 알려준다 — `!rm -rf` 를 질문으로 착각하면 늦다 */}
          {mode && <span className={`composer__mode composer__mode--${mode}`}>{MODE_HINT[mode]}</span>}
          {/* 보고 있는 문서가 함께 간다는 것을 미리 알린다 */}
          {!mode && viewing && (
            <span className="composer__mode composer__mode--file">📄 {viewing} 함께 보냄</span>
          )}
        </div>
        <div className="composer__slot composer__slot--end">
          {right}
          <button
            type="button"
            className="composer__send"
            onClick={submit}
            disabled={disabled || !value.trim()}
            title="전송 (Enter)"
            aria-label="전송"
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  )
}
