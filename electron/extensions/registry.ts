import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  parseManifest,
  type ExtensionManifest,
  type ManifestParseFailure,
} from '../../shared/extensions/manifest'

// 설치된 확장을 훑어 목록을 만든다.
//
// 설치 경로: ~/.open-code/desktop-extensions/{name}/manifest.json (계획서 §2.2)
// 에어갭에서 **폴더째 복사**로 설치되므로, 사람이 손으로 만든 매니페스트가 온다.
// → 깨진 것을 조용히 버리면 "복사했는데 목록에 안 뜬다" 로 끝난다.
//   **건너뛴 것도 사유와 함께 돌려준다.**
//
// 훑기 골격은 `electron/runtime/instanceScanner.ts:51-77` 을 그대로 따랐다.

/** 확장 하나를 못 실은 사유. 파일 단계 4개 + 매니페스트 파서가 돌려준 것. */
export type ExtensionSkipReason =
  | 'no_manifest'
  | 'unreadable'
  | 'invalid_json'
  | 'broken_link'
  | ManifestParseFailure

export interface LoadedExtension {
  /** 확장 디렉토리의 절대경로. `manifest.main` 을 여기 기준으로 푼다 (P2) */
  dir: string
  manifest: ExtensionManifest
}

export interface SkippedExtension {
  dir: string
  reason: ExtensionSkipReason
}

export interface ExtensionScan {
  extensions: LoadedExtension[]
  skipped: SkippedExtension[]
}

/**
 * 확장 설치 디렉토리의 기본 경로. 환경변수가 있으면 그쪽이 우선한다.
 *
 * `app.getPath('userData')` 를 쓰지 않는 이유가 둘 있다:
 * 앱 재설치와 확장 수명을 분리하려는 것(계획서 §2.2), 그리고 `electron` 을
 * 끌어오면 vitest(node 환경)에서 모킹이 필요해지는 것.
 * `defaultRuntimeHome`/`defaultInstancesDir` 과 같은 시그니처다.
 */
export function defaultExtensionsDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env['OPEN_CODE_EXTENSIONS_DIR']
  if (override) return override
  return join(homedir(), '.open-code', 'desktop-extensions')
}

/**
 * 확장 디렉토리 한 겹을 훑는다.
 *
 * 디렉토리가 아예 없으면 빈 결과다 — 확장을 하나도 안 깐 것이 정상 상태라
 * 사유를 붙일 대상 자체가 없다.
 */
export async function scanExtensions(extensionsDir: string): Promise<ExtensionScan> {
  let entries
  try {
    entries = await readdir(extensionsDir, { withFileTypes: true })
  } catch {
    return { extensions: [], skipped: [] }
  }

  const extensions: LoadedExtension[] = []
  const skipped: SkippedExtension[] = []

  for (const entry of entries) {
    // 점으로 시작하는 디렉토리는 확장이 아니라 **연장의 살림살이**다 (`.git`·`.omc`).
    // 확장 폴더를 버전 관리하는 것은 흔한 일인데, 그때마다 `.git` 이
    // 「싣지 못한 확장」으로 잡혀 사용자가 고칠 수 없는 사유가 설정 창에 남는다.
    if (entry.name.startsWith('.')) continue

    const dir = join(extensionsDir, entry.name)

    // 디렉토리가 아닌 것(.DS_Store 등)은 애초에 확장 후보가 아니다 — 사유에 넣지 않는다.
    //
    // **단 심링크는 따라간다.** `readdir(withFileTypes)` 는 심링크에
    // `isDirectory() === false` 를 주는데, 확장을 개발 트리에 걸어두는
    // (`ln -s ~/dev/my-ext ~/.open-code/desktop-extensions/my-ext`) 것은 흔한 워크플로다.
    // 그냥 넘기면 설치한 확장이 **사유도 없이 사라진다** — 계획서 §3 P1 이 금지한 것이다.
    if (entry.isSymbolicLink()) {
      const target = await followLink(dir)
      // 끊긴 링크는 사람이 걸어둔 뒤 대상이 사라진 것이다. 무음으로 버리면 원인을 못 찾는다
      if (target === 'missing') {
        skipped.push({ dir, reason: 'broken_link' })
        continue
      }
      if (target === 'other') continue
    } else if (!entry.isDirectory()) continue

    const result = await loadExtension(dir)
    if (result.ok) extensions.push({ dir, manifest: result.manifest })
    else skipped.push({ dir, reason: result.reason })
  }

  return { extensions, skipped }
}

/** 심링크가 가리키는 것. `stat` 은 링크를 따라간다 — `lstat`·`readdir` 과 다른 점이다. */
async function followLink(path: string): Promise<'directory' | 'other' | 'missing'> {
  try {
    return (await stat(path)).isDirectory() ? 'directory' : 'other'
  } catch {
    return 'missing'
  }
}

type LoadResult = { ok: true; manifest: ExtensionManifest } | { ok: false; reason: ExtensionSkipReason }

/** 확장 디렉토리 하나에서 manifest.json 을 읽어 파서에 넘긴다. */
async function loadExtension(dir: string): Promise<LoadResult> {
  const path = join(dir, 'manifest.json')

  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    // 없는 것과 못 읽는 것(권한·손상)은 고치는 방법이 달라 갈라 놓는다
    return { ok: false, reason: isNotFound(error) ? 'no_manifest' : 'unreadable' }
  }

  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'invalid_json' }
  }

  return parseManifest(data)
}

function isNotFound(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}
