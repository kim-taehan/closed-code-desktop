import { ipcMain } from 'electron'
import { Channel } from '../../shared/ipc/channels'
import type { SettingsStore } from '../settings/settingsStore'
import { normalizeSettings } from '../../shared/settings/appSettings'
import { installPackage } from '../extensions/install'
import { fetchRegistryIndex } from '../extensions/registryFetch'
import { fetchRegistryReadme } from '../extensions/registryReadmeFetch'
import { discardDownload, downloadPackage } from '../extensions/packageDownload'
import type {
  RegistryAddPayload,
  RegistryFetchPayload,
  RegistryInstallPayload,
  RegistryInstallRequest,
  RegistryListPayload,
  RegistryReadmePayload,
  RegistryReadmeRequest,
  RegistryUrlPayload,
} from '../../shared/ipc/extensionRegistryPayloads'

// 확장 **배포처** 핸들러. `extensionBridge.ts` 가 300줄 상한에 붙어 갈라냈다
// (선례: `projectBridge` → `projectFsHandlers`).
//
// 클래스가 아니라 순수 함수 묶음이다 — 이 핸들러들이 쥐는 상태가 없다.
// 필요한 것(설정 저장소·설치 위치·fetch)만 `RegistryDeps` 로 받는다.
//
// **해제(`removeHandler`)는 여기서 하지 않는다.** 채널 목록의 정본은 저쪽의
// `HANDLED_CHANNELS` 이고, 등록만 옮겨 놓고 해제를 나눠 가지면 새 채널을 더할 때
// 한쪽만 고쳐진다 (`wiring.test.ts` 두 번째 케이스가 잡는 사고).

export interface RegistryDeps {
  settings: SettingsStore
  /** 패키지가 풀리는 곳 */
  extensionsDir: string
  /** 시험에서 갈아끼운다. 기본은 전역 fetch */
  fetchImpl?: typeof fetch
}

/**
 * 배포처 채널 다섯을 등록한다.
 *
 * `afterInstall` 만 밖에서 받는다 — 설치가 끝나면 확장 호스트를 다시 싣는 일인데,
 * 그건 배포처가 아니라 **확장 호스트**의 사정이라 여기서 알 이유가 없다.
 */
export function registerRegistryHandlers(
  deps: RegistryDeps,
  /** `replaced` 는 **덮어쓴 설치인가** — 부르는 쪽이 이걸로 자식을 갈지 정한다 */
  afterInstall: (
    result: RegistryInstallPayload,
    replaced: boolean,
  ) => Promise<RegistryInstallPayload>,
): void {
  ipcMain.handle(Channel.EXTENSION_REGISTRY_LIST, () => registryList(deps))
  ipcMain.handle(Channel.EXTENSION_REGISTRY_ADD, (_event, payload: RegistryUrlPayload) =>
    registryAdd(deps, payload),
  )
  ipcMain.handle(Channel.EXTENSION_REGISTRY_REMOVE, (_event, payload: RegistryUrlPayload) =>
    registryRemove(deps, payload),
  )
  ipcMain.handle(Channel.EXTENSION_REGISTRY_FETCH, (_event, payload: RegistryUrlPayload) =>
    registryFetch(deps, payload),
  )
  ipcMain.handle(Channel.EXTENSION_REGISTRY_README, (_event, payload: RegistryReadmeRequest) =>
    registryReadme(deps, payload),
  )
  ipcMain.handle(
    Channel.EXTENSION_REGISTRY_INSTALL,
    async (_event, payload: RegistryInstallRequest) => {
      const { replaced, ...result } = await registryInstall(deps, payload)
      return afterInstall(result, replaced)
    },
  )
}

export async function registryList(deps: RegistryDeps): Promise<RegistryListPayload> {
  return { urls: (await deps.settings.load()).extensionRegistries }
}

/**
 * 주소를 더한다. **저장 전에 한 번 걸러 사유를 돌려준다** —
 * `settings.save` 도 `normalizeSettings` 로 http/https 아닌 것을 떨어뜨리지만,
 * 거기서 걸리면 조용히 사라져 사용자는 오타를 냈다는 것을 알 수 없다.
 *
 * 거르는 규칙을 여기 다시 쓰지 않고 `normalizeSettings` 를 그대로 태워 본다 —
 * 규칙이 두 곳에 갈라지면 언젠가 한쪽만 바뀐다.
 */
export async function registryAdd(deps: RegistryDeps, payload: RegistryUrlPayload): Promise<RegistryAddPayload> {
  const probe = normalizeSettings({ extensionRegistries: [payload.url] })
  const url = probe.extensionRegistries[0]
  if (url === undefined) return { ok: false, reason: 'bad_url' }

  const current = await deps.settings.load()
  if (current.extensionRegistries.includes(url)) return { ok: false, reason: 'duplicate' }

  // 뒤에 붙인다 — 사용자가 넣은 순서가 화면 순서다
  const saved = await deps.settings.save({
    ...current,
    extensionRegistries: [...current.extensionRegistries, url],
  })
  return { ok: true, urls: saved.extensionRegistries }
}

/** 없는 주소를 빼도 실패로 만들지 않는다 — 부르는 쪽이 원한 결과(그 주소가 없음)는 같다. */
export async function registryRemove(deps: RegistryDeps, payload: RegistryUrlPayload): Promise<RegistryListPayload> {
  const current = await deps.settings.load()
  const saved = await deps.settings.save({
    ...current,
    extensionRegistries: current.extensionRegistries.filter((url) => url !== payload.url),
  })
  return { urls: saved.extensionRegistries }
}

/**
 * 배포처 하나를 조회한다. 실패해도 던지지 않는다 — 배포처는 신뢰 경계 밖이라
 * 못 닿는 것이 정상 경로고, 화면이 사유를 사람 말로 보여줘야 한다.
 */
export async function registryFetch(deps: RegistryDeps, payload: RegistryUrlPayload): Promise<RegistryFetchPayload> {
  const result = await fetchRegistryIndex({
    url: payload.url,
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  })
  if (result.ok) return { ok: true, url: payload.url, index: result.index }
  return {
    ok: false,
    url: payload.url,
    reason: result.reason,
    ...(result.detail ? { detail: result.detail } : {}),
  }
}

/**
 * 받기 전에 볼 설명을 받아온다.
 *
 * 조회(`registryFetch`)와 같은 규율이다 — 못 받아도 던지지 않고 사유를 돌려준다.
 * 다만 여기서 **"설명 없음" 은 만들지 않는다.** 주소가 있다는 것은 배포처가 설명이
 * 있다고 말한 것이고, 그런데 못 받았으면 배포처가 틀린 것이다.
 */
export async function registryReadme(
  deps: RegistryDeps,
  payload: RegistryReadmeRequest,
): Promise<RegistryReadmePayload> {
  const result = await fetchRegistryReadme({
    url: payload.url,
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  })
  if (result.ok) return { ok: true, text: result.text }
  return {
    ok: false,
    reason: result.reason,
    ...(result.detail ? { detail: result.detail } : {}),
  }
}

/**
 * 배포처에서 내려받아 설치한다 — **받기 + 디스크 설치와 똑같은 경로.**
 *
 * 받은 것을 특별 취급하지 않는다. `installPackage` 가 zip slip 을 다시 검사하고
 * 매니페스트를 다시 읽는다. 배포처가 사내라도 그 안의 패키지는 누가 올렸는지 모른다.
 *
 * 이름·버전은 배포처 목록이 아니라 **패키지 안 매니페스트**에서 나온 것을 돌려준다.
 * 설치 폴더 이름을 정하는 것도 그쪽이라, 둘이 어긋나면 매니페스트가 사실이다.
 */
export async function registryInstall(
  deps: RegistryDeps,
  payload: RegistryInstallRequest,
): Promise<RegistryInstallPayload & { replaced: boolean }> {
  const downloaded = await downloadPackage({
    url: payload.url,
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  })
  if (!downloaded.ok) {
    return {
      ok: false,
      replaced: false,
      reason: downloaded.reason,
      ...(downloaded.detail ? { detail: downloaded.detail } : {}),
    }
  }

  try {
    const result = await installPackage({
      packagePath: downloaded.path,
      extensionsDir: deps.extensionsDir,
    })
    if (!result.ok) {
      return {
        ok: false,
        replaced: false,
        reason: result.reason,
        ...(result.detail ? { detail: result.detail } : {}),
      }
    }
    return {
      ok: true,
      name: result.manifest.name,
      version: result.manifest.version,
      replaced: result.replaced,
    }
  } finally {
    // 설치가 끝났든 실패했든 받아 둔 것은 치운다. 못 치워도 설치 결과를 뒤집지 않는다
    await discardDownload(downloaded.dir)
  }
}
