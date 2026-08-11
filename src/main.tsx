import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary, ErrorPage, installBlankScreenGuard } from './components/ErrorPage'
import pkg from '../package.json'

// 창 제목(네이티브 타이틀바)에 버전을 실어 어느 빌드인지 바로 보이게 한다.
document.title = `AXGentic Desktop (${pkg.version})`

const container = document.getElementById('root')
if (!container) throw new Error('#root 엘리먼트를 찾을 수 없습니다')

const root = createRoot(container)
// React 밖(부트 중 throw·미처리 rejection)에서 죽어 흰 화면이 된 경우 — 루트가 비어 있을 때만 덮는다
installBlankScreenGuard(container, (error) => root.render(<ErrorPage error={error} />))
root.render(
  <StrictMode>
    {/* 렌더 중 throw 로 트리 전체가 날아가는 흰 화면의 방어선 (전례: a17ba09) */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
