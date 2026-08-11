import Markdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { t } from '../i18n/messages'
import type { ReadmeState } from '../state/readmeState'

// 설명 한 편을 그린다. 설치본 상세와 배포처 상세가 함께 쓴다 —
// **같은 글이 자리마다 다르게 보이면 안 된다.**
//
// 마크다운 렌더러는 `FileViewer` 가 쓰는 것을 그대로 쓴다 — 새 의존성을 들이지 않는다.

export function ReadmeView({ state, noneHint }: { state: ReadmeState; noneHint: string }) {
  return (
    <div className="dc-ext__readme">
      {state.kind === 'loading' && <p className="dc-ext__empty">{t('불러오는 중…')}</p>}

      {state.kind === 'none' && (
        <p className="dc-ext__empty">
          {t('이 확장에는 설명이 없습니다.')}
          <br />
          {noneHint}
        </p>
      )}

      {state.kind === 'error' && <p className="dc-ext__fail">{state.message}</p>}

      {state.kind === 'text' && (
        <div className="dc-ext__md">
          <Markdown
            rehypePlugins={[[rehypeHighlight, { detect: true }]]}
            remarkPlugins={[remarkGfm]}
          >
            {state.text}
          </Markdown>
        </div>
      )}
    </div>
  )
}
