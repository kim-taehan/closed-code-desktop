import React, { useEffect, useRef, useState } from 'react'
import type { Components } from 'react-markdown'

// 펜스 코드 블록 — vscode MarkdownCodeComponent 미러 (언어 라벨 + 복사 + 접기).
//
// 스트리밍 중에는 헤더/버튼/접기 없는 축소판 <pre> 를 쓴다 — 청크마다 wrapper
// 기계장치(측정 effect·버튼 리렌더)를 돌리는 것이 지터의 주범이라서다 (vscode 동일).
// 접힘 판정(scrollHeight 측정)은 정착 후 mount 시 1회만 한다.
// vscode 의 Run/Run&AskAI 버튼과 execCommand 폴백(고아)은 미러하지 않는다.

/** 이 높이를 넘으면 접는다 — 대략 15줄 (vscode 실측값 그대로) */
const CODE_COLLAPSE_THRESHOLD = 240 // px

// react-markdown + rehype-highlight 는 토큰 단위 <span> ReactElement 와
// plain string 이 섞인 children 배열을 넘긴다. 복사 시 원본 코드를 그대로
// 실어보내려면 React 노드 트리 전체에서 텍스트를 **재귀 평탄화**해야 한다.
// (DC-681: 얕은 매핑이 ReactElement 자식을 빈 문자열로 만들어 식별자/문자열/
// 타입명이 누락된 채 클립보드에 들어간 사고 전례.)
export function extractText(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (React.isValidElement(node)) {
    return extractText((node.props as { children?: React.ReactNode })?.children)
  }
  // 배열·iterable children — React.Children.toArray 가 표준 평탄화/필터링을 처리
  return React.Children.toArray(node).map(extractText).join('')
}

const CopyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
  </svg>
)

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

interface CodeBlockWrapperProps {
  language: string
  codeContent: string
  className: string
  children: React.ReactNode
}

function CodeBlockWrapper({ language, codeContent, className, children }: CodeBlockWrapperProps) {
  const [collapsed, setCollapsed] = useState(true)
  const [copied, setCopied] = useState(false)
  const [isLong, setIsLong] = useState(false)
  const preRef = useRef<HTMLPreElement>(null)

  // 정착 후 1회 측정 — 임계값을 넘는 블록만 접기 대상이 된다
  useEffect(() => {
    const codeEl = preRef.current?.querySelector('code')
    if (codeEl && codeEl.scrollHeight > CODE_COLLAPSE_THRESHOLD) setIsLong(true)
  }, [])

  function handleCopy(event: React.MouseEvent): void {
    event.stopPropagation()
    void navigator.clipboard.writeText(codeContent).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="codeBlock">
      <div className="code-block-header">
        <span className="code-block-lang">{language}</span>
        <div className="code-block-actions">
          <button
            type="button"
            className={`code-block-action-btn code-block-copy-btn${copied ? ' copied' : ''}`}
            onClick={handleCopy}
            title={copied ? '복사됨' : '코드 복사'}
          >
            {copied ? <><CheckIcon /> 복사됨</> : <><CopyIcon /> 복사</>}
          </button>
        </div>
      </div>
      <pre
        ref={preRef}
        className={`hljs code-block-container${isLong && collapsed ? ' code-block-collapsed' : ''}`}
      >
        <code className={className}>{children}</code>
      </pre>
      {isLong && (
        <button
          type="button"
          className="code-block-expand-btn"
          onClick={() => setCollapsed((previous) => !previous)}
        >
          {collapsed ? '▼ 더 보기' : '▲ 접기'}
        </button>
      )}
    </div>
  )
}

/**
 * 펜스 블록 판정: 언어 태그가 있거나 내용이 여러 줄이면 블록, 아니면 인라인.
 * 인라인 `code` 는 그대로 통과시킨다.
 */
function splitCode(className: string | undefined, children: React.ReactNode) {
  const classNameStr = className ?? ''
  const match = /language-(\w+)/.exec(classNameStr)
  const codeContent = extractText(children)
  const isInline = !match && !codeContent.includes('\n')
  return { classNameStr, language: match?.[1] ?? '', codeContent, isInline }
}

/** 정착 후: 풀 wrapper (헤더 + 복사 + 접기) */
export const settledCode: Components['code'] = ({ className, children }) => {
  const { classNameStr, language, codeContent, isInline } = splitCode(className, children)
  if (isInline) return <code className={classNameStr}>{children}</code>
  return (
    <CodeBlockWrapper language={language} codeContent={codeContent} className={classNameStr}>
      {children}
    </CodeBlockWrapper>
  )
}

/**
 * 스트리밍 중: 축소판 <pre>. 하단 고정은 CSS-only (flex + 240px 창) —
 * scrollTop 조작은 청크마다 한 프레임 늦게 칠해져 내부 지터를 만든다 (vscode 실측).
 */
export const streamingCode: Components['code'] = ({ className, children }) => {
  const { classNameStr, isInline } = splitCode(className, children)
  if (isInline) return <code className={classNameStr}>{children}</code>
  return (
    <pre className="streaming-code-block">
      <code className={classNameStr}>{children}</code>
    </pre>
  )
}
