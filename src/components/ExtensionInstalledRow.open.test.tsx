// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExtensionInstalledRow } from './ExtensionInstalledRow'
import type { ExtensionEntryPayload } from '../../shared/ipc/extensionPayloads'

// 설정 창 확장 목록의 「열기」 (E5 진입점). 웹뷰 뷰마다 하나, **켜진 확장에만**.

afterEach(cleanup)

const V3: ExtensionEntryPayload = {
  name: 'webview-fixture',
  displayName: '웹뷰 시험 확장',
  version: '0.0.1',
  dir: '/x/webview-v3',
  enabled: true,
  contributes: {
    views: [
      { id: 'board', title: '보드', kind: 'webview', entry: 'ui/index.html' },
      { id: 'rows', title: '표', kind: 'table' },
    ],
  },
}

function row(extension: ExtensionEntryPayload, onOpenView?: (viewId: string, title: string) => void) {
  return render(
    <ExtensionInstalledRow
      extension={extension}
      toggleLabel="이 프로젝트에서 켜기 — p"
      onOpenDetail={() => {}}
      onSetEnabled={() => {}}
      onUninstall={() => {}}
      {...(onOpenView ? { onOpenView } : {})}
    />,
  )
}

describe('「열기」', () => {
  it('웹뷰 뷰에만 뜨고, 누르면 그 뷰를 연다', () => {
    const onOpenView = vi.fn()
    const view = row(V3, onOpenView)
    const buttons = view.getAllByRole('button', { name: '열기' })
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0]!)
    expect(onOpenView).toHaveBeenCalledWith('board', '보드')
  })

  it('꺼진 확장이나 열 프로젝트가 없으면 안 뜬다', () => {
    expect(row({ ...V3, enabled: false }, vi.fn()).queryByRole('button', { name: '열기' })).toBeNull()
    cleanup()
    expect(row(V3).queryByRole('button', { name: '열기' })).toBeNull()
  })
})
