// 배포처 목록 문서(index.json)의 타입과 파서.
//
// 표준은 `docs/reference/extension-standard.md` §4.4 가 정본이다. 핵심 두 가지:
//
// - **앱은 특정 서버에 붙지 않고 이 문서 모양에만 붙는다.** 그래야 임시 로컬 서버든
//   Admin 서버든 파일 공유에 올려둔 정적 파일이든 배포처가 될 수 있다.
// - **`url` 은 목록 문서 기준 상대경로다.** 절대 URL 로 적으면 배포처를 폴더째 옮기는
//   순간 전부 깨진다 — 에어갭에서는 배포처를 통째로 복사해 나르는 일이 실제로 생긴다.
//   그래서 파싱과 동시에 문서 주소 기준으로 풀어 둔다. 절대 URL 도 그대로 받는다.
//
// `manifest.ts` 와 같은 `{ ok, reason }` 모양이다. 조용히 삼키면 왜 안 뜨는지 알 길이 없다.
// 다만 **문서 전체를 버리는 사유**와 **항목 하나를 버리는 사유**를 가른다 —
// 확장 하나가 깨졌다고 배포처 전체를 못 쓰게 만들 이유가 없다 (`scanExtensions` 와 같은 판단).

/** 이 앱이 읽을 수 있는 목록 문서 판. 여기 없는 판은 거부한다. */
export const SUPPORTED_REGISTRY_VERSIONS = [1] as const

export interface RegistryVersion {
  version: string
  /** 문서 주소 기준으로 이미 풀린 **절대 URL** */
  url: string
  /** 없어도 된다 — 정적 파일로 손수 쓰는 배포처에 강요하지 않는다 */
  size?: number
  uploadedAt?: string
  /**
   * 받기 전에 보여줄 설명(마크다운) 주소. `url` 과 같은 규칙으로 풀린다.
   *
   * **없는 것이 정상이다.** 정적 파일로 손수 쓰는 배포처는 설명을 따로 내놓지 않고,
   * 그때는 화면이 `description` 한 줄로 버틴다.
   */
  readme?: string
}

export interface RegistryEntry {
  name: string
  displayName: string
  description?: string
  /** 배포처가 권하는 버전. `versions` 에 실제로 있는 것만 살아남는다 */
  latest: string
  /** 높은 버전이 먼저. 배포처가 준 순서를 그대로 둔다 — 우리가 semver 를 재정렬하지 않는다 */
  versions: RegistryVersion[]
}

/** 문서 전체를 못 읽은 사유. */
export type RegistryParseFailure =
  | 'not_object'
  | 'missing_registry_version'
  | 'unsupported_registry_version'
  | 'missing_extensions'

/** 항목 하나를 버린 사유. 나머지 항목은 살린다. */
export type RegistryEntrySkipReason =
  | 'missing_name'
  | 'missing_versions'
  | 'no_usable_version'
  | 'missing_latest'

export interface SkippedRegistryEntry {
  /** 이름조차 못 읽었으면 문서에서의 자리를 대신 준다 */
  name: string | null
  index: number
  reason: RegistryEntrySkipReason
}

export interface RegistryIndex {
  registryVersion: number
  /** 화면에 보일 배포처 이름. 없으면 부르는 쪽이 주소로 대신한다 */
  name?: string
  entries: RegistryEntry[]
  skipped: SkippedRegistryEntry[]
}

export type RegistryParseResult =
  | { ok: true; index: RegistryIndex }
  | { ok: false; reason: RegistryParseFailure }

/**
 * 목록 문서를 파싱한다. `baseUrl` 은 **이 문서를 받아온 주소**다.
 *
 * 상대 URL 을 여기서 푸는 이유: 상대경로의 기준이 "문서 주소" 라는 것이 계약의 일부라,
 * 그 기준을 아는 유일한 자리가 여기다. 뒤로 넘기면 어디선가 기준이 바뀐다.
 */
export function parseRegistryIndex(data: unknown, baseUrl: string): RegistryParseResult {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, reason: 'not_object' }
  }
  const source = asRecord(data)

  // 판을 가장 먼저 본다 — 모르는 판이면 나머지 필드의 의미도 보장할 수 없다
  const registryVersion = source['registryVersion']
  if (typeof registryVersion !== 'number') {
    return { ok: false, reason: 'missing_registry_version' }
  }
  if (!SUPPORTED_REGISTRY_VERSIONS.some((known) => known === registryVersion)) {
    return { ok: false, reason: 'unsupported_registry_version' }
  }

  const rawEntries = source['extensions']
  // 빈 배열은 정상이다 (아직 아무것도 안 올린 배포처). 배열이 아닌 것만 거부한다.
  if (!Array.isArray(rawEntries)) return { ok: false, reason: 'missing_extensions' }

  const entries: RegistryEntry[] = []
  const skipped: SkippedRegistryEntry[] = []

  rawEntries.forEach((raw, index) => {
    const result = toEntry(raw, baseUrl)
    if (result.ok) entries.push(result.entry)
    else skipped.push({ name: result.name, index, reason: result.reason })
  })

  const name = source['name']

  return {
    ok: true,
    index: {
      registryVersion,
      ...(typeof name === 'string' && name !== '' ? { name } : {}),
      entries,
      skipped,
    },
  }
}

type EntryResult =
  | { ok: true; entry: RegistryEntry }
  | { ok: false; name: string | null; reason: RegistryEntrySkipReason }

function toEntry(value: unknown, baseUrl: string): EntryResult {
  const source = asRecord(value)

  const rawName = source['name']
  const name = typeof rawName === 'string' && rawName !== '' ? rawName : null
  if (name === null) return { ok: false, name: null, reason: 'missing_name' }

  const rawVersions = source['versions']
  if (!Array.isArray(rawVersions) || rawVersions.length === 0) {
    return { ok: false, name, reason: 'missing_versions' }
  }

  // 주소를 못 푸는 항목은 내려받을 수 없다 — 목록에 띄워두면 누르는 순간 실패한다
  const versions = rawVersions
    .map((raw) => toVersion(raw, baseUrl))
    .filter((v): v is RegistryVersion => v !== null)
  if (versions.length === 0) return { ok: false, name, reason: 'no_usable_version' }

  // latest 가 실제로 받을 수 있는 버전을 가리켜야 한다. 아니면 첫 항목으로 떨어뜨리지 않고
  // 버린다 — 배포처가 틀린 것을 앱이 조용히 고쳐주면 틀린 채로 남는다.
  const rawLatest = source['latest']
  const latest = typeof rawLatest === 'string' && rawLatest !== '' ? rawLatest : null
  if (latest === null || !versions.some((v) => v.version === latest)) {
    return { ok: false, name, reason: 'missing_latest' }
  }

  const displayName = source['displayName']
  const description = source['description']

  return {
    ok: true,
    entry: {
      name,
      displayName: typeof displayName === 'string' && displayName !== '' ? displayName : name,
      ...(typeof description === 'string' && description !== '' ? { description } : {}),
      latest,
      versions,
    },
  }
}

function toVersion(value: unknown, baseUrl: string): RegistryVersion | null {
  const source = asRecord(value)

  const version = source['version']
  if (typeof version !== 'string' || version === '') return null

  const rawUrl = source['url']
  if (typeof rawUrl !== 'string' || rawUrl === '') return null
  const url = resolveUrl(rawUrl, baseUrl)
  if (url === null) return null

  const size = source['size']
  const uploadedAt = source['uploadedAt']

  // 설명 주소는 못 풀어도 버리지 않는다 — 받는 것(url)은 멀쩡한데 설명 하나 때문에
  // 항목이 통째로 사라지면 설치할 수 있는 확장이 목록에서 없어진다
  const rawReadme = source['readme']
  const readme = typeof rawReadme === 'string' && rawReadme !== '' ? resolveUrl(rawReadme, baseUrl) : null

  return {
    version,
    url,
    // 0 이하는 크기가 아니다. 없는 것과 같게 본다
    ...(typeof size === 'number' && Number.isFinite(size) && size > 0 ? { size } : {}),
    ...(typeof uploadedAt === 'string' && uploadedAt !== '' ? { uploadedAt } : {}),
    ...(readme !== null ? { readme } : {}),
  }
}

/**
 * 문서 주소를 기준으로 푼다. 절대 URL 이면 그대로 남는다 (`URL` 의 기본 동작).
 *
 * `http`/`https` 만 받는다. `file:`·`data:` 를 살려두면 배포처 문서 한 줄로 로컬 파일을
 * 가리키게 만들 수 있다 — 배포처는 신뢰 경계 **바깥**이다 (표준 §4.4).
 */
function resolveUrl(raw: string, baseUrl: string): string | null {
  try {
    const resolved = new URL(raw, baseUrl)
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null
    return resolved.toString()
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}
