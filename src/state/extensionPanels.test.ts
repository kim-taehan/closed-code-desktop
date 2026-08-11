import { describe, expect, it } from 'vitest'
import { extensionPanelId, extensionPanelTargets, isExtensionPanelId } from './extensionPanels'
import type { ExtensionEntry } from './extensionRows'

// 설치 목록 → 사이드바 패널 목록.

function entry(name: string, views: { id: string; title: string }[]): ExtensionEntry {
  return {
    name,
    displayName: name,
    version: '1.0.0',
    dir: `/확장/${name}`,
    enabled: true,
    contributes: { views: views.map((view) => ({ ...view, kind: 'table' as const })) },
  }
}

describe('확장 패널 id', () => {
  it('내장 패널 이름과 섞이지 않는다', () => {
    expect(isExtensionPanelId('files')).toBe(false)
    expect(isExtensionPanelId('git')).toBe(false)
    expect(isExtensionPanelId('history')).toBe(false)
    expect(isExtensionPanelId(extensionPanelId('a'))).toBe(true)
  })

  it('확장마다 다르다', () => {
    expect(extensionPanelId('가')).not.toBe(extensionPanelId('나'))
  })
})

describe('설치 목록을 패널 목록으로', () => {
  it('뷰가 몇이든 확장 하나가 패널 하나다', () => {
    // 뷰 하나를 항목 하나로 두면 확장 하나가 선택기를 여러 줄 차지한다
    // (실측: 테스트 시나리오 확장이 화면·API·결과로 세 칸을 먹었다).
    const panels = extensionPanelTargets([
      entry('test-scenario', [
        { id: 'ts.screens', title: '화면' },
        { id: 'ts.apis', title: 'API' },
        { id: 'ts.result', title: '결과' },
      ]),
    ])

    expect(panels).toHaveLength(1)
    expect(panels[0]?.id).toBe('ext:test-scenario')
    // 선택기에 뜨는 이름은 **확장 이름**이다 — 뷰 제목은 패널 안의 탭이 된다
    expect(panels[0]?.title).toBe('test-scenario')
    expect(panels[0]?.views.map((view) => view.title)).toEqual(['화면', 'API', '결과'])
  })

  it('표시 이름을 쓴다 — 디렉터리 이름은 사람이 읽으라고 지은 것이 아니다', () => {
    const named: ExtensionEntry = {
      ...entry('test-scenario', [{ id: 'v', title: '화면' }]),
      displayName: '테스트 시나리오',
    }

    expect(extensionPanelTargets([named])[0]?.title).toBe('테스트 시나리오')
  })

  it('뷰가 없는 확장은 나오지 않는다 — 그려 줄 화면이 없다', () => {
    const noViews: ExtensionEntry = {
      name: 'commands-only',
      displayName: 'commands-only',
      version: '1.0.0',
      dir: '/확장/commands-only',
      enabled: true,
      contributes: { commands: [{ id: 'c', title: '실행' }] },
    }

    expect(extensionPanelTargets([noViews])).toEqual([])
  })

  it('contributes 자체가 없어도 터지지 않는다', () => {
    const bare: ExtensionEntry = { name: 'bare', displayName: 'bare', version: '1.0.0', dir: '/확장/bare', enabled: true }

    expect(extensionPanelTargets([bare])).toEqual([])
  })

  it('순서는 설치 목록 순서 → 확장 안의 뷰 선언 순서다', () => {
    // 이름순 정렬 같은 것을 끼우면 확장 개발자가 자기 화면이 어디 뜰지 예측할 수 없다.
    const panels = extensionPanelTargets([
      entry('나중', [{ id: 'v1', title: 'ㄱ' }]),
      entry('먼저', [
        { id: 'v2', title: 'ㅎ' },
        { id: 'v3', title: 'ㄴ' },
      ]),
    ])

    expect(panels.map((panel) => panel.title)).toEqual(['나중', '먼저'])
    expect(panels[1]?.views.map((view) => view.title)).toEqual(['ㅎ', 'ㄴ'])
  })
})
