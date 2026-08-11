import type { SettingsStore } from '../settings/settingsStore'
import { uninstallExtension } from '../extensions/uninstall'
import type {
  ExtensionSetEnabledPayload,
  ExtensionUninstallPayload,
  ExtensionUninstallResult,
} from '../../shared/ipc/extensionPayloads'

// 설치본을 **켜고 끄고 지우는** 핸들러. `extensionBridge.ts` 가 300줄 상한에 붙어 갈라냈다
// (선례: `extensionRegistryHandlers.ts`).
//
// 둘 다 끝나면 호스트를 **다시 싣는다.** 다음 앱 실행에나 반영되면 토글을 눌러도
// 아무 일이 없는 것처럼 보인다.

export interface ManageDeps {
  settings: SettingsStore
  /** 패키지가 풀린 곳. 지우기가 이 폴더 **바로 아래**만 건드린다 */
  extensionsDir: string
  /** 지우기 전에 이름을 찾고, 조작 뒤에 다시 싣는 데 쓴다 */
  service: {
    listExtensions(): Promise<{ extensions: { dir: string; manifest: { name: string } }[] }>
    reload(): Promise<void>
    /** 자식을 갈아 끼운다. **덮어쓴 설치에서만** 부른다 (아래 `afterInstall`) */
    restart(): Promise<void>
  }
}

export async function setExtensionEnabled(
  deps: ManageDeps,
  { name, enabled }: ExtensionSetEnabledPayload,
): Promise<void> {
  const current = await deps.settings.load()
  const without = current.disabledExtensions.filter((item) => item !== name)
  await deps.settings.save({
    ...current,
    disabledExtensions: enabled ? without : [...without, name],
  })
  await reloadHost(deps)
}

/**
 * 지우기. **꺼 둔 기록도 함께 지운다** — 안 그러면 같은 이름을 다시 깔았을 때
 * 조용히 꺼진 채로 들어온다.
 */
export async function uninstallInstalled(
  deps: ManageDeps,
  { dir }: ExtensionUninstallPayload,
): Promise<ExtensionUninstallResult> {
  // 이름은 **지우기 전에** 찾는다. 지운 뒤에는 매니페스트를 읽을 수 없다
  const listing = await deps.service.listExtensions()
  const name = listing.extensions.find((item) => item.dir === dir)?.manifest.name ?? null

  const removed = await uninstallExtension(deps.extensionsDir, dir)
  if (!removed.ok) return removed

  if (name !== null) {
    const current = await deps.settings.load()
    if (current.disabledExtensions.includes(name)) {
      await deps.settings.save({
        ...current,
        disabledExtensions: current.disabledExtensions.filter((item) => item !== name),
      })
    }
  }

  await reloadHost(deps)
  return { ok: true }
}

/**
 * 설치가 끝났으니 확장을 다시 싣는다.
 *
 * **덮어쓴 설치(=업데이트)만 자식을 갈아 끼운다.** 자식의 `require` 캐시가 옛 모듈을
 * 쥐고 있어, 덮어쓴 코드는 새 자식에서만 실린다 — 안 갈면 목록의 버전만 올라가고
 * 동작은 옛것으로 남는다.
 *
 * 처음 설치하는 것은 캐시에 없어 `reload` 로 충분하다. 자식을 가는 값(모든 확장의
 * 상태·진행 중 명령이 날아간다)을 치를 이유가 없다.
 */
export async function afterInstall(deps: ManageDeps, replaced: boolean): Promise<void> {
  try {
    await (replaced ? deps.service.restart() : deps.service.reload())
  } catch {
    // 서비스가 이미 로그를 남겼다
  }
}

/** 재싣기가 실패해도 조작 자체는 성공이다 — 사유는 서비스가 앱 로그로 흘린다. */
export async function reloadHost(deps: ManageDeps): Promise<void> {
  try {
    await deps.service.reload()
  } catch {
    // 서비스가 이미 로그를 남겼다
  }
}
