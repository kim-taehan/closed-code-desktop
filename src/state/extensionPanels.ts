import type { ExtensionView } from '../../shared/extensions/manifest'
import type { ExtensionEntry } from './extensionRows'

// 설치된 확장을 **사이드바 패널 하나**로 바꾼다.
//
// **확장 하나 = 선택기 항목 하나다.** 예전에는 뷰 하나가 곧 항목 하나였는데, 뷰를 셋
// 선언한 확장 하나가 선택기를 세 줄 차지했다 (실측: 테스트 시나리오 확장이 「화면」·
// 「API」·「작성된 시나리오」로 세 칸). 확장이 몇 개만 깔려도 목록이 무엇의 목록인지
// 알 수 없게 된다 — 뷰는 **패널 안의 탭**으로 가른다.
//
// 확장을 「확장」이라는 칸 하나에 몰아넣지 않는다는 결정(`SidebarPanelSelect.tsx` 머리말)은
// 그대로다. 한 칸에 모이는 것은 **한 확장의 뷰들**이지 여러 확장이 아니다.
//
// 명령을 선언했지만 **뷰가 없는 확장은 여기 나오지 않는다.** 그려 줄 화면이 없어서다.
// 그런 확장은 설정 창의 설치 목록에만 산다.

/** 사이드바 패널 id 중 확장이 등록한 것. 내장 셋(`files`·`git`·`history`)과 섞이지 않는다. */
export type ExtensionPanelId = `ext:${string}`

/**
 * 확장 이름으로 만든다.
 *
 * 뷰 id 를 더 이상 담지 않는다 — 한 확장이 한 칸이라 뷰로 가를 이유가 없어졌다.
 * 확장 이름은 설치 디렉터리 이름이라 앱 안에서 유일하다.
 */
export function extensionPanelId(extensionName: string): ExtensionPanelId {
  return `ext:${extensionName}`
}

export function isExtensionPanelId(panel: string): panel is ExtensionPanelId {
  return panel.startsWith('ext:')
}

/** 패널 하나를 그리는 데 필요한 것 전부 — 선택기 항목이자 본문의 재료다. */
export interface ExtensionPanelTarget {
  id: ExtensionPanelId
  /** 선택기에 뜰 이름. 매니페스트의 표시 이름이라 **번역하지 않는다.** */
  title: string
  extension: ExtensionEntry
  /** 이 확장이 선언한 뷰 전부. 패널 안에서 **탭**이 된다. 선언 순서 그대로다. */
  views: ExtensionView[]
}

/**
 * 설치 목록을 패널 목록으로.
 *
 * 순서는 **설치 목록 순서**다. 여기서 이름순 정렬 같은 것을 끼우면 확장 개발자가
 * 자기 화면이 어디에 뜰지 예측할 수 없다.
 */
export function extensionPanelTargets(extensions: ExtensionEntry[]): ExtensionPanelTarget[] {
  return extensions.flatMap((extension) => {
    const views = extension.contributes?.views ?? []
    if (views.length === 0) return []
    // 표시 이름이 비어 있으면 디렉터리 이름으로 버틴다 — 이름 없는 칸은 고를 수가 없다
    return [{ id: extensionPanelId(extension.name), title: extension.displayName || extension.name, extension, views }]
  })
}
