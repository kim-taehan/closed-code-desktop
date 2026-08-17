import { lstat, mkdtemp, mkdir, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { describeError } from '../errors/describeError'
import {
  detectArchiveFormat,
  extractArchive,
  listArchiveEntries,
  normalizeExtractedStructure,
} from './archive'
import { parseManifest, type ExtensionManifest } from '../../shared/extensions/manifest'

// 확장 패키지(.axcx — 안은 zip)를 설치 폴더에 푼다.
//
// **먼저 열어보고 나서 푼다.** 압축 안에 `../../evil` 같은 경로가 있으면 푸는 순간
// 설치 폴더 *바깥*에 파일이 생긴다(zip slip). 풀린 뒤에는 그 파일이 설치 폴더 안에
// 없으므로 사후 검사로 못 잡는다 — 그래서 `listArchiveEntries` 로 이름을 먼저 본다.
// 폴더 복사 설치에는 없던 위험이고, 사용자가 아무 파일이나 고를 수 있어서 우리가 막아야 한다.
//
// 임시 폴더는 **설치 폴더 옆에** 만든다. `os.tmpdir()` 은 다른 볼륨일 수 있어
// 마지막 `rename` 이 EXDEV 로 실패한다.
//
// 확장자는 보지 않는다 — `detectArchiveFormat` 이 매직바이트로 판별하므로
// `.axcx` 든 `.zip` 이든 안이 맞으면 풀린다. 확장자는 파일 선택창의 필터일 뿐이다.

export type InstallFailure =
  /** 압축을 열어볼 수 없었다 (아카이브가 아니거나 깨졌다) */
  | 'unreadable_package'
  /** 압축 안에 설치 폴더 밖을 가리키는 경로가 있다 — zip slip */
  | 'unsafe_entry'
  /** 푸는 데 실패했다 */
  | 'extract_failed'
  /** manifest.json 이 없다 */
  | 'no_manifest'
  /** manifest.json 이 JSON 이 아니다 */
  | 'invalid_json'
  /** manifest.json 을 못 읽었다 (파서가 준 사유를 `detail` 로 함께 올린다) */
  | 'invalid_manifest'
  /** 설치 폴더로 옮기지 못했다 */
  | 'move_failed'

export type InstallResult =
  | {
      ok: true
      manifest: ExtensionManifest
      dir: string
      /** 같은 이름이 이미 있어 덮어썼는가 = **업데이트**인가 */
      replaced: boolean
    }
  | { ok: false; reason: InstallFailure; detail?: string }

export interface InstallOptions {
  /** 사용자가 고른 패키지 파일 */
  packagePath: string
  /** 확장이 설치되는 곳. 없으면 만든다 */
  extensionsDir: string
}

/**
 * 압축 항목 이름이 풀어도 안전한가.
 *
 * 순수 함수로 뺀 이유 — 이게 이 파일에서 유일한 보안 판정이고, 파일시스템 없이
 * 시험으로 못 박을 수 있어야 한다.
 *
 * 막는 것:
 * - 절대경로 (`/etc/x`, 윈도우 `C:\x`)
 * - 어느 조각이든 `..`
 * - 홈 확장 (`~`) — 셸이 아니라 풀리지는 않지만, 이런 이름을 담은 패키지는 정상이 아니다
 */
export function isSafeEntry(entry: string): boolean {
  const name = entry.trim()
  if (name === '') return false
  if (name.startsWith('/') || name.startsWith('\\')) return false
  if (/^[a-zA-Z]:[/\\]/.test(name)) return false
  if (name.startsWith('~')) return false
  return !name
    .split(/[/\\]/)
    .some((segment) => segment === '..')
}

export async function installPackage(options: InstallOptions): Promise<InstallResult> {
  const { packagePath, extensionsDir } = options

  let entries: string[]
  try {
    entries = await listArchiveEntries(packagePath)
  } catch (error) {
    return { ok: false, reason: 'unreadable_package', detail: describeError(error) }
  }

  // 하나라도 밖을 가리키면 **풀지 않는다.** 걸러서 푸는 것이 아니라 통째로 거부한다 —
  // 그런 패키지는 정상 경로로 만들어진 것이 아니다.
  const unsafe = entries.find((entry) => !isSafeEntry(entry))
  if (unsafe !== undefined) return { ok: false, reason: 'unsafe_entry', detail: unsafe }

  await mkdir(extensionsDir, { recursive: true })
  const staging = await mkdtemp(join(extensionsDir, '.install-'))

  try {
    try {
      const format = await detectArchiveFormat(packagePath)
      await extractArchive(packagePath, staging, format)
      // 패키지가 폴더 한 겹을 감싸고 있어도 받아준다 (압축할 때 흔한 실수다)
      await normalizeExtractedStructure(staging)
    } catch (error) {
      return { ok: false, reason: 'extract_failed', detail: describeError(error) }
    }

    const parsed = await readManifest(staging)
    if (!parsed.ok) return parsed

    const dir = join(extensionsDir, parsed.manifest.name)
    // 덮어쓰는지 **지우기 전에** 본다. 부르는 쪽이 이걸로 호스트를 갈아야 할지 정한다 —
    // 자식의 require 캐시가 옛 모듈을 쥐고 있어, 덮어쓴 코드는 자식을 새로 띄워야 실린다.
    const replaced = await exists(dir)
    try {
      // 같은 이름이 있으면 덮어쓴다 — 이것이 곧 업데이트다
      await rm(dir, { recursive: true, force: true })
      await rename(staging, dir)
    } catch (error) {
      return { ok: false, reason: 'move_failed', detail: describeError(error) }
    }
    return { ok: true, manifest: parsed.manifest, dir, replaced }
  } finally {
    // rename 이 성공했으면 이미 없다. 실패했거나 중간에 빠져나왔으면 여기서 치운다.
    await rm(staging, { recursive: true, force: true })
  }
}

async function readManifest(
  dir: string,
): Promise<{ ok: true; manifest: ExtensionManifest } | { ok: false; reason: InstallFailure; detail?: string }> {
  let text: string
  try {
    text = await readFile(join(dir, 'manifest.json'), 'utf8')
  } catch {
    return { ok: false, reason: 'no_manifest' }
  }

  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (error) {
    return { ok: false, reason: 'invalid_json', detail: describeError(error) }
  }

  const parsed = parseManifest(data)
  // 파서의 사유를 그대로 detail 에 실어 올린다 — 무엇을 빠뜨렸는지 알아야 고친다
  if (!parsed.ok) return { ok: false, reason: 'invalid_manifest', detail: parsed.reason }
  return { ok: true, manifest: parsed.manifest }
}

/** 심링크로 깔린 확장도 "있다" 로 본다 — 끊어진 링크를 덮어쓰는 것도 업데이트다 */
async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch {
    return false
  }
}
