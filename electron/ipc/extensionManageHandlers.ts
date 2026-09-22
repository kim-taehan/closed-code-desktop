import { uninstallExtension } from '../extensions/uninstall'
import { forgetExtensionSessions } from '../opencode/extensionSessions'
import { forgetExtensionSecrets } from '../extensions/secretStore'
import type { ProjectExtensionsPort } from '../extensions/projectExtensions'
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
//
// 켜고 끄기는 **프로젝트마다**다 (확장 재설계 §3). 예전에는 `settings.disabledExtensions`
// 한 벌에 썼고, 이제 그 설정은 이전에만 읽고 쓰지 않는다 (`projectExtensions.ts`).

export interface ManageDeps {
  /** 프로젝트마다 켠 확장. 켜고 끄기·지우기가 여기에 쓴다 */
  projects: ProjectExtensionsPort
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
  { name, enabled, projectId }: ExtensionSetEnabledPayload,
): Promise<void> {
  // 설치된 이름은 이전에 쓴다 — 아직 이전 안 된 프로젝트에서 처음 누른 것이면, 옛 기준으로
  // 켜져 있던 것들을 먼저 채워야 이 하나만 남고 나머지가 꺼지는 일이 없다
  const listing = await deps.service.listExtensions()
  const installed = listing.extensions.map((item) => item.manifest.name)
  await deps.projects.set(projectId, name, enabled, installed)
  // 호스트는 모든 프로젝트의 합집합을 싣는다 — 켜고 끄면 그 합집합이 바뀔 수 있다
  await reloadHost(deps)
}

/**
 * 지우기. **모든 프로젝트의 켠 기록에서도 뺀다** — 안 그러면 같은 이름을 다시 깔았을 때
 * 예전에 켰던 프로젝트들에서 조용히 켜진 채로 들어온다.
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

  if (name !== null) await deps.projects.forget(name)
  // 그 확장의 AI 세션 줄도 뺀다 — 다시 깔면 새 세션으로 시작한다. 이력 숨김은 남는다 (`extensionSessions.ts`)
  if (name !== null) forgetExtensionSessions(name)
  // 그 확장의 비밀도 지운다 — 다시 깐 같은 이름이(남이 올린 것일 수도 있다) 앞 토큰을 읽으면 안 된다 (`secretStore.ts`)
  if (name !== null) await forgetExtensionSecrets(name)

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
