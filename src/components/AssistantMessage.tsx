import { useDeferredValue } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import rehypeHighlight from 'rehype-highlight'
import type { ChatMessage } from '../../shared/ipc/messageTypes'
import { settledCode, streamingCode } from './CodeBlock'

// 어시스턴트 텍스트 버블 (설계 §6.7).
//
// vscode 와 같은 마크다운 파이프라인을 쓴다:
//   remark: gfm + breaks (항상)
//   rehype: highlight — **스트리밍 중에는 비활성**
// 스트리밍 중 하이라이팅을 돌리면 청크마다 전체 트리를 다시 칠하느라 느려진다.
// 코드 블록도 같은 이유로 갈린다: 정착 후엔 풀 wrapper(복사·접기), 스트리밍 중엔 축소판.

// 모듈 스코프에 두어 렌더마다 새 배열이 생기지 않게 한다 (react-markdown 이 참조로 비교한다)
const REMARK_PLUGINS = [remarkGfm, remarkBreaks]
const REHYPE_STREAMING: [] = []
const REHYPE_SETTLED = [rehypeHighlight]

const SHARED_COMPONENTS: Components = {
  // 코드 컴포넌트가 자체 <pre> 를 만들므로 여기서는 통과시킨다
  pre: ({ children }) => <>{children}</>,
  table: ({ children }) => (
    <div style={{ overflowX: 'auto', width: '100%' }}>
      <table style={{ minWidth: '100%' }}>{children}</table>
    </div>
  ),
  img: ({ src, alt }) => (
    <span className="cc-inline-image">
      <img src={typeof src === 'string' ? src : undefined} alt={alt ?? ''} loading="lazy" />
      {alt && <span className="cc-image-caption">{alt}</span>}
    </span>
  ),
}

// vscode 는 컨텍스트로 스트리밍 여부를 내리지만, 여기는 code 항목만 다른
// 정적 맵 두 벌이면 충분하다 (isStreamingTarget prop 이 이미 이 컴포넌트에 온다)
const COMPONENTS_SETTLED: Components = { ...SHARED_COMPONENTS, code: settledCode }
const COMPONENTS_STREAMING: Components = { ...SHARED_COMPONENTS, code: streamingCode }

export interface AssistantMessageProps {
  message: ChatMessage
  /** 이 버블이 지금 스트리밍 중인 그 하나인가 (턴당 정확히 하나) */
  isStreamingTarget?: boolean
  railEnd?: boolean
  /** 턴 안에서는 인라인 interrupted 라벨을 억제한다 (턴 뒤에 하나만 붙는다) */
  hideInterruptedLabel?: boolean
}

export function AssistantMessage({
  message,
  isStreamingTarget = false,
  railEnd = false,
  hideInterruptedLabel = false,
}: AssistantMessageProps) {
  // React 19 가 청크를 모아 처리하도록 지연값을 쓴다
  const content = useDeferredValue(message.content)

  const semanticClass = message.semanticType ? ` cc-assistant-message--${message.semanticType}` : ''
  const railClass = railEnd ? ' cc-rail-end' : ''

  return (
    <div className={`cc-assistant-message${semanticClass}${railClass}`}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={isStreamingTarget ? REHYPE_STREAMING : REHYPE_SETTLED}
        components={isStreamingTarget ? COMPONENTS_STREAMING : COMPONENTS_SETTLED}
      >
        {content}
      </ReactMarkdown>
      {message.interrupted && !hideInterruptedLabel && (
        <div className="cc-interrupted-label">interrupted</div>
      )}
    </div>
  )
}
