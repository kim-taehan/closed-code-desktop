// 배포처 탭 시험이 함께 쓰는 stub 과 붙박이 값.
//
// 시험 파일이 300줄 상한에 걸려 둘로 갈리면서(`*.test.tsx` / `*.fail.test.tsx`)
// 두 파일이 같은 stub 을 세워야 했다. **한 곳에 둔다** — 갈라 두면 한쪽만 고쳐진다.
//
// `davisStub` 은 모듈 하나당 한 벌이라 시험 파일마다 `mockReset()` 으로 시작한다.

import { render } from '@testing-library/react'
import { vi } from 'vitest'
import { ExtensionRegistryTab } from './ExtensionRegistryTab'
import type { RegistryEntry, RegistryIndex } from '../../shared/extensions/registryIndex'
import type { ExtensionEntryPayload } from '../../shared/ipc/extensionPayloads'
import type {
  RegistryAddPayload,
  RegistryFetchPayload,
  RegistryInstallPayload,
  RegistryListPayload,
  RegistryReadmePayload,
} from '../../shared/ipc/extensionRegistryPayloads'

export const URL_A = 'http://localhost:4321/index.json'
export const URL_B = 'https://axgentic.skax.local/extensions/index.json'

/** 파서를 이미 통과한 모양이다 — 화면은 파싱을 하지 않는다 (main 몫). */
export function index(name: string, entries: RegistryEntry[]): RegistryIndex {
  return { registryVersion: 1, name, entries, skipped: [] }
}

export const OUTLINE: RegistryEntry = {
  name: 'sample-ext',
  displayName: '샘플 확장',
  description: '무언가를 모읍니다',
  latest: '0.2.0',
  versions: [{ version: '0.2.0', url: 'http://localhost:4321/packages/sample-ext/0.2.0' }],
}

export const davisStub = {
  listExtensionRegistries: vi.fn<() => Promise<RegistryListPayload>>(),
  addExtensionRegistry: vi.fn<() => Promise<RegistryAddPayload>>(),
  removeExtensionRegistry: vi.fn<() => Promise<RegistryListPayload>>(),
  fetchExtensionRegistry: vi.fn<() => Promise<RegistryFetchPayload>>(),
  fetchExtensionRegistryReadme: vi.fn<() => Promise<RegistryReadmePayload>>(),
  installExtensionFromRegistry: vi.fn<() => Promise<RegistryInstallPayload>>(),
}
;(window as unknown as { davis: unknown }).davis = davisStub

export function renderTab(installed: ExtensionEntryPayload[] = [], onInstalled?: () => void) {
  return render(<ExtensionRegistryTab installed={installed} onInstalled={onInstalled} />)
}
