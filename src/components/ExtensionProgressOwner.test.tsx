// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ExtensionViewPanel } from './ExtensionViewPanel'
import type { ExtensionPanelTarget } from '../state/extensionPanels'
import type { ExtensionProgressPayload } from '../../shared/ipc/channels'

// **보고 있는 확장의 진행만 그린다.**
//
// 잡는 회귀: 진행 줄이 앱에 하나뿐이라, `redraw` 가 함께 돌린 다른 확장의 문구가 지금 보는
// 확장의 행동 바에 찍혔다 (실측: 테스트 시나리오 트리 아래에
// 「analyzer(http://localhost:8080) 에서 실행을 찾는 중…」 — 현행분석 확장의 것).
//
// 가르는 자리가 여기인 이유: 자기가 **어느 확장인지**(`target`) 아는 것은 이 패널뿐이다.

const TARGET: ExtensionPanelTarget = {
  id: 'ext:test-scenario',
  title: '테스트 시나리오',
  views: [{ id: 'ts.screens', title: '화면', kind: 'tree' }],
  extension: {
    name: 'test-scenario',
    displayName: '테스트 시나리오',
    version: '0.2.0',
    dir: '/확장/test-scenario',
    enabled: true,
    contributes: { commands: [{ id: 'ts.write', title: '테스트 시나리오 작성' }] },
  },
}

const MINE: ExtensionProgressPayload = { extension: 'test-scenario', text: '작성 중…', done: 2, total: 7 }
const THEIRS: ExtensionProgressPayload = {
  extension: 'current-analysis',
  text: 'analyzer(http://localhost:8080) 에서 실행을 찾는 중…',
}

function Panel(props: { progressByExtension: Record<string, ExtensionProgressPayload> }) {
  return (
    <ExtensionViewPanel
      target={TARGET}
      projectId="p1"
      expanded={{ of: () => new Set<string>(), toggle: () => {} }}
      rowsByView={{}}
      treesByView={{ 'ts.screens': [{ id: 'src/A.tsx', label: 'A.tsx' }] }}
      htmlByView={{}}
      running={[]}
      progressByExtension={props.progressByExtension}
      progressLog={{}}
      onCancel={() => {}}
      onRunCommand={() => Promise.resolve(true)}
      onOpenRow={() => {}}
      onOpenPath={() => {}}
      onOpenHtml={() => {}}
      onNotice={() => {}}
    />
  )
}

afterEach(cleanup)

describe('진행 줄은 보고 있는 확장의 것만', () => {
  it('남의 확장 진행은 그리지 않는다 — 고른 것 안내가 그대로 남는다', () => {
    render(<Panel progressByExtension={{ 'current-analysis': THEIRS }} />)

    expect(screen.queryByText(/analyzer/)).toBeNull()
    expect(screen.getByText('고른 것이 없습니다')).toBeTruthy()
  })

  it('내 확장 진행은 그린다 — 분수까지', () => {
    render(<Panel progressByExtension={{ 'test-scenario': MINE }} />)

    expect(screen.getByText(/작성 중…/)).toBeTruthy()
    expect(screen.getByText('2/7')).toBeTruthy()
  })

  it('둘이 함께 돌아도 내 것만 고른다', () => {
    render(<Panel progressByExtension={{ 'current-analysis': THEIRS, 'test-scenario': MINE }} />)

    expect(screen.getByText(/작성 중…/)).toBeTruthy()
    expect(screen.queryByText(/analyzer/)).toBeNull()
  })
})
