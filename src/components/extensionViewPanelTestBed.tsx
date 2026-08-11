// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { vi } from 'vitest'
import { ExtensionViewPanel } from './ExtensionViewPanel'
import type { ExtensionPanelTarget } from '../state/extensionPanels'

// `ExtensionViewPanel` 의 **표 뷰** 시험이 함께 쓰는 자리
// (`extensionRegistryTestBed` 와 같은 방식). 거르개·정렬과 내보내기가 같은 표를 쓰는데,
// 한 파일에 두면 300줄 상한을 넘긴다.

export const TARGET: ExtensionPanelTarget = {
  id: 'ext:sample-ext',
  title: '샘플 확장',
  views: [{ id: 'sampleExt.results', title: '샘플 확장', kind: 'table' }],
  extension: {
    name: 'sample-ext',
    displayName: '샘플 확장',
    version: '0.2.0',
    dir: '/확장/sample-ext',
    enabled: true,
    contributes: { commands: [{ id: 'sampleExt.run', title: '찾기' }] },
  },
}

export const ROWS = [
  { file: 'package-lock.json', bytes: 498000, lines: 11507, ext: 'json' },
  { file: 'src/App.tsx', bytes: 9000, lines: 287, ext: 'tsx' },
  { file: 'src/main.ts', bytes: 400, lines: 12, ext: 'ts' },
]

/** 표 뷰만 보므로 트리가 없다 — 펼침도 쓸 일이 없다 (`ExtensionViewTabs.test.tsx` 가 본다). */
const NO_EXPANDED = { of: () => new Set<string>(), toggle: () => {} }

interface CsvPayload {
  suggestedName: string
  csv: string
}

/** 내보내기가 부르는 유일한 IPC. 다른 시험은 여기 닿지 않지만 렌더에는 필요하다 */
export function stubExport(result: unknown = { ok: true, path: '/tmp/x.csv' }) {
  const exportExtensionCsv = vi.fn((_payload: CsvPayload) => Promise.resolve(result))
  ;(globalThis as unknown as { window: { davis: unknown } }).window ??= {} as never
  ;(window as unknown as { davis: unknown }).davis = { exportExtensionCsv }
  return exportExtensionCsv
}

export function renderPanel(
  rows: Record<string, unknown>[] = ROWS,
  onNotice: (text: string) => void = () => {},
) {
  render(
    <ExtensionViewPanel
      target={TARGET}
      projectId="p1"
      expanded={NO_EXPANDED}
      rowsByView={{ 'sampleExt.results': rows }}
      treesByView={{}}
      htmlByView={{}}
      onOpenPath={() => {}}
      running={[]}
      progressByExtension={{}}
      progressLog={{}}
      onCancel={() => {}}
      onRunCommand={() => Promise.resolve(true)}
      onOpenRow={() => {}}
      onOpenHtml={() => {}}
      onNotice={onNotice}
    />,
  )
}

/** 표 본문의 파일 칸만 (머리글 제외) */
export function files(): string[] {
  return [...document.querySelectorAll('tbody tr')].map((row) => row.querySelector('td')?.textContent ?? '')
}
