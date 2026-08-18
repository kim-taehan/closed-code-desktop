import type {
  ExtensionListPayload,
  ExtensionRowPayload,
  ExtensionTreeNodePayload,
} from '../../shared/ipc/extensionPayloads'

// 서비스가 돌려주는 것을 **화면이 쓰는 모양으로** 추린다. `extensionBridge.ts` 가
// 300줄 상한에 붙어 갈라냈다.
//
// **매니페스트를 통째로 넘기지 않는다** — main 의 `LoadedExtension` 은 매니페스트 전체를
// 들고 있는데, 통째로 넘기면 매니페스트가 바뀔 때마다 renderer 가 흔들린다.
// `contributes` 만 그대로 통과시킨다 — 사이드바가 명령 버튼과 뷰 탭을 거기서 그린다.

/** 이 변환이 실제로 읽는 것만. `ExtensionManifest` 가 이 모양을 만족한다. */
export interface ManifestLike {
  name: string
  displayName: string
  version: string
  description?: string
  contributes?: ExtensionListPayload['extensions'][number]['contributes']
}

export interface ServiceListing {
  extensions: { dir: string; manifest: ManifestLike; enabled: boolean }[]
  skipped: { dir: string; reason: string; detail?: string }[]
}

export function toListPayload(listing: ServiceListing): ExtensionListPayload {
  return {
    extensions: listing.extensions.map(({ dir, manifest, enabled }) => ({
      name: manifest.name,
      displayName: manifest.displayName,
      version: manifest.version,
      ...(manifest.description ? { description: manifest.description } : {}),
      ...(manifest.contributes ? { contributes: manifest.contributes } : {}),
      dir,
      enabled,
    })),
    skipped: listing.skipped.map(({ dir, reason, detail }) => ({
      dir,
      reason,
      ...(detail ? { detail } : {}),
    })),
  }
}

/**
 * 표에 그릴 수 있는 행만 남긴다.
 *
 * 확장이 무엇을 넣을지 앱이 정하지 않으므로 문자열·숫자·배열도 올 수 있는데,
 * 표는 **칸을 키로 찾는다** — 객체가 아닌 행은 열을 만들 수 없어 빈 줄이 된다.
 */
export function toRows(rows: unknown[]): ExtensionRowPayload[] {
  return rows.filter(
    (row): row is ExtensionRowPayload =>
      row !== null && typeof row === 'object' && !Array.isArray(row),
  )
}

/**
 * 확장이 올린 트리 마디를 화면이 받을 모양으로 좁힌다.
 *
 * **남의 데이터라 통째로 믿지 않는다.** `id`·`label` 이 없는 마디는 화면에서 고를 수도
 * 보일 수도 없으므로 그 자리에서 버린다 — 그리다가 터지면 뷰 전체가 빈 화면이 된다.
 * 행(`toRows`)과 같은 태도이고, 다른 점은 재귀라는 것뿐이다.
 */
/** 줄 버튼 하나. 이름과 명령이 **둘 다** 있어야 그린다 — 하나만 오면 누를 수 없거나 빈 버튼이 된다. */
function toAction(value: unknown): { label: string; command: string } | null {
  if (value === null || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  const label = source['label']
  const command = source['command']
  if (typeof label !== 'string' || label === '' || typeof command !== 'string' || command === '') return null
  return { label, command }
}

export function toTreeNodes(nodes: unknown[]): ExtensionTreeNodePayload[] {
  return nodes.flatMap((node) => {
    if (node === null || typeof node !== 'object') return []
    const source = node as Record<string, unknown>
    const id = source['id']
    const label = source['label']
    if (typeof id !== 'string' || id === '' || typeof label !== 'string') return []

    const children = source['children']
    const badge = source['badge']
    const detail = source['detail']
    // 구획은 **참일 때만** 담는다 — `section: false` 를 실어 보내는 확장과 안 적은 확장이
    // 같은 뜻이라, 담아 두면 없는 차이가 payload 에 남는다
    const section = source['section'] === true
    // 모르는 값은 **조용히 뺀다** — 줄의 형편은 곁다리라, 오타 하나로 트리 전체가 사라지면 안 된다
    const state = source['state']
    const known = state === 'waiting' || state === 'running' || state === 'failed'
    // 줄 버튼. 이름과 명령이 **둘 다** 있어야 그린다 — 하나만 오면 누를 수 없거나 빈 버튼이 된다
    const action = toAction(source['action'])
    // 여럿일 때 (`actions`). 깨진 항목만 버리고 나머지는 담는다 — 하나가 오타라고
    // 그 줄의 버튼을 전부 없애면 무엇이 잘못됐는지 화면이 말해 주지 않는다
    const actions = Array.isArray(source['actions'])
      ? source['actions'].map(toAction).filter((one): one is { label: string; command: string } => one !== null)
      : []
    return [
      {
        id,
        label,
        ...(typeof detail === 'string' && detail !== '' ? { detail } : {}),
        ...(section ? { section } : {}),
        ...(typeof badge === 'string' && badge !== '' ? { badge } : {}),
        ...(known ? { state: state as 'waiting' | 'running' | 'failed' } : {}),
        ...(action !== null ? { action } : {}),
        ...(actions.length > 0 ? { actions } : {}),
        ...(Array.isArray(children) ? { children: toTreeNodes(children) } : {}),
      },
    ]
  })
}
