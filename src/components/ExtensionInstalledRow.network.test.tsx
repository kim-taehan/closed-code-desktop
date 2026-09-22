// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ExtensionInstalledRow } from './ExtensionInstalledRow'
import type { ExtensionEntryPayload } from '../../shared/ipc/extensionPayloads'

// 바깥에 닿는 확장은 **켜기 스위치 옆에** 닿는 출처를 보인다 (매니페스트 `network`, 하이닉스 §5-1).
// 켜기가 곧 「여기로 나가도 된다」는 결정이라 누르기 전에 보여야 한다.

afterEach(cleanup)

function entry(network?: string[]): ExtensionEntryPayload {
  // payload 에 싣는 쪽은 `electron/ipc/extensionListPayload.test.ts` 가 본다
  return { name: 'jira', displayName: '요구사항', version: '0.1.0', dir: '/x/jira', enabled: false, ...(network ? { network } : {}) }
}

function row(extension: ExtensionEntryPayload) {
  return render(
    <ExtensionInstalledRow
      extension={extension}
      toggleLabel="이 프로젝트에서 켜기 — p"
      onOpenDetail={() => {}}
      onSetEnabled={() => {}}
      onUninstall={() => {}}
    />,
  )
}

describe('연결하는 곳', () => {
  it('꺼진 채로도 출처가 보인다 — 켜기 전에 알아야 한다', () => {
    const { getByText } = row(entry(['https://jira.example.com', 'https://jira2.example.com']))
    expect(getByText(/연결하는 곳/).textContent).toBe('연결하는 곳: https://jira.example.com, https://jira2.example.com')
  })

  it('바깥에 안 닿는 확장은 그 줄이 없다', () => {
    const { queryByText } = row(entry())
    expect(queryByText(/연결하는 곳/)).toBeNull()
  })
})
