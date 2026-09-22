import type { ExtensionScan } from './registry'

// "지금 어느 확장이 켜져 있나" 한 가지만 다룬다. `service.ts` 가 300줄 상한에 붙어 갈라냈고,
// 판정이 두 자리(목록에 표시 / 실을 것 고르기)에서 쓰이므로 규칙을 한곳에 둔다 —
// 갈라 두면 목록엔 켜졌다고 뜨는데 실제로는 안 실리는 어긋남이 난다.
//
// 켜짐은 이제 **프로젝트마다**다 (확장 재설계 §3). 그래서 두 자리가 보는 집합이 다르다 —
// 목록은 **활성 프로젝트**의 것, 싣기는 **모든 프로젝트의 합집합**이다. 집합을 고르는 것은
// `projectExtensions.ts` 이고, 여기는 집합을 받아 목록에 붙이거나 거르는 일만 한다.
// (예전에는 앱 전체의 「꺼 둔 이름」 한 벌을 두 자리가 같이 봤다.)

/** 훑어 찾은 확장 하나 + 지금 켜져 있는지. 꺼진 것도 **목록에는 남는다.** */
export type ListedExtension = ExtensionScan['extensions'][number] & { enabled: boolean }

/** 훑은 확장들의 이름. 이전(`projectExtensions.ts`)이 「지금 설치된 것」으로 쓴다 */
export function installedNames(extensions: ExtensionScan['extensions']): string[] {
  return extensions.map((extension) => extension.manifest.name)
}

/** 목록용 — 전부 남기고 켜짐 여부만 붙인다. */
export function withEnabled(
  extensions: ExtensionScan['extensions'],
  enabled: ReadonlySet<string>,
): ListedExtension[] {
  return extensions.map((extension) => ({
    ...extension,
    enabled: enabled.has(extension.manifest.name),
  }))
}

/** 싣기용 — 꺼진 것은 아예 안 넘긴다. 자식이 명령표를 통째로 갈아끼우므로 그대로 사라진다. */
export function onlyEnabled(
  extensions: ExtensionScan['extensions'],
  enabled: ReadonlySet<string>,
): ExtensionScan['extensions'] {
  return extensions.filter((extension) => enabled.has(extension.manifest.name))
}
