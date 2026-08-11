// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { WorkingDirBar } from './WorkingDirBar'

// 현재 세션 작업 경로 바 (ADR-036 / DC-1146).

afterEach(cleanup)

describe('작업 경로 바', () => {
  it('override 가 없으면 아무것도 그리지 않는다 — 평상시 화면을 어지럽히지 않는다', () => {
    const { container } = render(<WorkingDirBar workingDir={{ active: false }} />)
    expect(container.innerHTML).toBe('')
  })

  it('active 인데 경로가 없으면 그리지 않는다', () => {
    const { container } = render(<WorkingDirBar workingDir={{ active: true }} />)
    expect(container.innerHTML).toBe('')
  })

  it('경로와 프로젝트명을 보여준다', () => {
    render(
      <WorkingDirBar
        workingDir={{
          active: true,
          kind: 'external',
          path: '/home/fixture/external-docs',
          projectName: 'external:external-docs',
        }}
      />,
    )
    expect(screen.getByText('external:external-docs')).toBeTruthy()
    expect(screen.getByText('/home/fixture/external-docs')).toBeTruthy()
  })

  it('워크스페이스 밖이면 그렇다고 표시한다', () => {
    render(
      <WorkingDirBar workingDir={{ active: true, kind: 'external', path: '/tmp/outside' }} />,
    )
    expect(screen.getByText('워크스페이스 밖')).toBeTruthy()
  })

  it('external 이 아니면 경고 태그를 붙이지 않는다', () => {
    render(<WorkingDirBar workingDir={{ active: true, kind: 'directory', path: '/repo/sub' }} />)
    expect(screen.queryByText('워크스페이스 밖')).toBeNull()
  })

  it('projectName 이 없으면 경로 마지막 조각을 이름으로 쓴다', () => {
    render(<WorkingDirBar workingDir={{ active: true, path: '/a/b/my-service' }} />)
    expect(screen.getByText('my-service')).toBeTruthy()
  })

  it('전체 경로를 툴팁으로 남긴다 — 바에서는 잘리기 때문', () => {
    const { container } = render(
      <WorkingDirBar workingDir={{ active: true, path: '/very/long/path/to/somewhere' }} />,
    )
    const bar = container.querySelector('.workdir-bar')
    expect(bar?.getAttribute('title')).toContain('/very/long/path/to/somewhere')
  })
})
