import type { ExtensionScan } from './registry'
import { describeError } from '../../shared/errors/describeError'

// "지금 어느 확장이 켜져 있나" 한 가지만 다룬다. `service.ts` 가 300줄 상한에 붙어 갈라냈고,
// 판정이 두 자리(목록에 표시 / 실을 것 고르기)에서 쓰이므로 규칙을 한곳에 둔다 —
// 갈라 두면 목록엔 켜졌다고 뜨는데 실제로는 안 실리는 어긋남이 난다.

/** 훑어 찾은 확장 하나 + 지금 켜져 있는지. 꺼진 것도 **목록에는 남는다.** */
export type ListedExtension = ExtensionScan['extensions'][number] & { enabled: boolean }

/**
 * 꺼 둔 이름들을 집합으로. 설정을 못 읽어도 **빈 집합으로 떨어진다** —
 * 설정 파일 하나 때문에 확장이 전부 안 보이면 사용자가 원인을 짐작할 수 없다.
 */
export async function disabledNames(
  read: (() => Promise<readonly string[]>) | undefined,
  onError: (message: string) => void,
): Promise<ReadonlySet<string>> {
  if (!read) return new Set()
  try {
    return new Set(await read())
  } catch (error) {
    onError(`꺼둔 목록을 못 읽었다: ${describeError(error)}`)
    return new Set()
  }
}

/** 목록용 — 전부 남기고 켜짐 여부만 붙인다. */
export function withEnabled(
  extensions: ExtensionScan['extensions'],
  disabled: ReadonlySet<string>,
): ListedExtension[] {
  return extensions.map((extension) => ({
    ...extension,
    enabled: !disabled.has(extension.manifest.name),
  }))
}

/** 싣기용 — 꺼진 것은 아예 안 넘긴다. 자식이 명령표를 통째로 갈아끼우므로 그대로 사라진다. */
export function onlyEnabled(
  extensions: ExtensionScan['extensions'],
  disabled: ReadonlySet<string>,
): ExtensionScan['extensions'] {
  return extensions.filter((extension) => !disabled.has(extension.manifest.name))
}
