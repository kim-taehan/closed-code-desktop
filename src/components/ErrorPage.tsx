import { Component, type ReactNode } from 'react'
import { describeError } from '../../shared/errors/describeError'
import { t } from '../i18n/messages'

// 렌더러가 죽어 흰 화면이 되는 케이스의 마지막 방어선 (전례: a17ba09 언어 변경 흰 화면).
//
// 두 갈래를 같은 페이지로 수렴한다:
//  1) React 렌더 중 throw → ErrorBoundary. 경계가 없으면 React 가 트리 전체를 unmount 해
//     흰 화면만 남는다.
//  2) React 밖 에러(부트 중 throw·미처리 rejection) → installBlankScreenGuard.
//     단, 루트가 이미 그려져 있으면 사소한 비동기 에러까지 전체 화면으로 덮지 않는다 (콘솔만).
//
// 메인 프로세스·세션은 살아 있으므로 location.reload() 재로드만으로 초기 화면에 복귀한다.
// renderer→main 로그 IPC 는 없다 — 콘솔에만 남긴다 (DevTools·로그 신설 없이).

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error): void {
    console.error('[renderer] 루트 렌더 실패:', error)
  }

  override render(): ReactNode {
    return this.state.error ? <ErrorPage error={this.state.error} /> : this.props.children
  }
}

/** 전체 화면 에러 페이지. 첫 실행 화면(dc-empty)과 같은 골격을 쓴다. */
export function ErrorPage({
  error,
  // 기본은 재로드 — jsdom 이 location.reload 재정의를 막아 테스트만 주입한다
  onReset = () => window.location.reload(),
}: {
  error: unknown
  onReset?: () => void
}) {
  const message = describeError(error)
  const stack = error instanceof Error ? error.stack : undefined

  return (
    <div className="dc-empty" role="alert">
      <h1 className="dc-empty__title">{t('화면을 그리지 못했습니다')}</h1>
      <p className="dc-empty__hint">{message || t('알 수 없는 오류')}</p>
      {stack && (
        <details style={{ maxWidth: 560 }}>
          <summary className="dc-empty__hint" style={{ cursor: 'pointer' }}>
            {t('자세한 내용')}
          </summary>
          <pre style={{ overflow: 'auto', fontSize: 11, textAlign: 'left', color: 'var(--dc-text-muted)' }}>
            {stack}
          </pre>
        </details>
      )}
      <button type="button" className="dc-empty__open" onClick={onReset}>
        {t('초기 상태로 돌아가기')}
      </button>
    </div>
  )
}

/**
 * React 밖에서 죽은 흰 화면만 잡는다 — **루트가 비어 있을 때만** 에러 페이지를 그린다.
 * 화면이 정상 렌더 중인 비동기 에러는 콘솔로 충분하다 (전체 화면으로 덮으면 과하다).
 */
export function installBlankScreenGuard(
  container: HTMLElement,
  render: (error: unknown) => void,
): void {
  const showIfBlank = (error: unknown) => {
    console.error('[renderer] 처리되지 않은 오류:', error)
    if (container.childElementCount === 0) render(error)
  }
  window.addEventListener('error', (event) => showIfBlank(event.error ?? event.message))
  window.addEventListener('unhandledrejection', (event) => showIfBlank(event.reason))
}
