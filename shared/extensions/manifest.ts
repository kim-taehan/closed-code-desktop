// 데스크톱 **확장(Extension)** 의 manifest.json 타입과 파서.
//
// ⚠️ runtime 의 **플러그인(Plugin)**(`src/app/plugins/`)과 다른 체계다.
// 확장은 사람이 화면에서 보는 것이고, 플러그인은 에이전트가 도구로 쓰는 것이다.
// 문구를 섞지 않는다.
//
// 표준은 `docs/reference/extension-standard.md` §4.1 이 정본이다. 특히 두 가지가
// 선례에서 배운 결정이라 되돌리지 않는다:
//
// - **`activationEvents` 를 받지 않는다.** VS Code 는 기여점(`contributes`)과 활성화를
//   따로 선언하게 했다가 1.74 부터 명령·뷰·언어를 기여점에서 자동 유도하도록 바꿨다.
//   둘을 따로 쓰면 중복이고 한쪽만 고치면 조용히 어긋난다. 명령을 선언했으면 그 명령이
//   불릴 때 깨어난다.
// - **`manifestVersion` 이 필수다.** 표준을 갈아엎어야 할 때 옛 확장을 알아보는 유일한
//   수단이다. 지금 한 줄이고, 나중에 넣으려면 이미 늦다.
//
// 매니페스트는 **runtime 에 가지 않는다.** 따라서 `envelope.ts` 의 snake_case 금지 규칙과
// 무관하고, 키 명명은 camelCase 로 간다.
//
// **왜 `null` 이 아니라 `{ ok }` 인가**: 다른 파서(`mcpConfig.ts` 등)는 WebSocket 프레임용이라
// "왜 버렸는지"를 돌려주지 않는다. 확장은 사람이 직접 설치하므로 **조용히 삼키면 왜 안 뜨는지
// 알 길이 없다.** 사유를 같이 돌려준다. 이 모양의 선례는 `electron/projects/projectFs.ts` 다.

/** 이 앱이 읽을 수 있는 매니페스트 판. 여기 없는 판은 거부한다. */
export const SUPPORTED_MANIFEST_VERSIONS = [1] as const

/**
 * 앱이 그릴 수 있는 뷰 종류.
 *
 * **`html` 은 원래 없던 것이고, "확장이 HTML 을 들고 오지 않는다" 던 결정을 뒤집은 것이다.**
 * 뒤집은 이유: 목록 → 상세 → 관계로 링크를 타고 다니는 화면은 행 배열로 표현되지 않는다.
 *
 * 뒤집으면서도 지킨 선은 이것이다 — **호스트는 그릴 뿐 내용을 모른다.** 호스트가 특정 확장의
 * 화면 모양("프로그램목록은 이렇게 생겼다")을 알기 시작하면 그것이 결합이다. 격리해 감싸는
 * 일은 `src/state/extensionHtmlDoc.ts` 가 하고, 거기서도 내용은 손대지 않는다.
 */
export type ExtensionViewKind = 'table' | 'tree' | 'list' | 'html'

/**
 * 명령이 앉을 자리.
 *
 * 예전에는 선언한 명령이 전부 같은 크기 알약으로 한 줄에 늘어섰다. 성격이 다른 셋
 * (준비·주행동·마무리)이 구분되지 않아 **무엇을 먼저 눌러야 하는지 화면이 말해 주지
 * 않았고**, 탭보다 위에 있어 적용 범위도 모호했다 (기획서 §1).
 *
 * - `header` — 준비 행동. 헤더 오른쪽에 작게. 프로젝트당 한 번이면 되는 일
 * - `menu`   — 마무리·드문 것. `⋯` 안으로. 늘 보이면 주 행동과 경쟁한다
 * - 없으면   — **주 행동.** 아래 고정 바에 크게. 여럿이면 첫 번째만 크고 나머지는 `⋯` 로
 */
export type ExtensionCommandPlacement = 'header' | 'menu'

export interface ExtensionCommand {
  id: string
  title: string
  placement?: ExtensionCommandPlacement
  /**
   * `placement: 'header'` 인 명령을 **그 뷰의 탭 안**에 둔다. 뷰 id 를 적는다.
   *
   * 안 적으면 예전처럼 패널 헤더(선택기 오른쪽)에 붙어 **확장 전체**에 걸린다.
   * 탭마다 하는 일이 다른 확장에서는 그 자리가 거짓말을 한다 — 테스트 시나리오의
   * 「전체 파일 보기」는 화면 탭에서만 뜻이 있는데 API 탭을 보는 중에도 떠 있었고,
   * 「목록 갱신」은 어느 탭을 갱신하는지 화면이 말해 주지 않았다.
   *
   * 모르는 뷰 id 를 적으면 **아무 데도 안 뜬다.** 헤더로 되돌리지 않는다 — 뷰를 적었다는
   * 것은 「거기 두겠다」는 뜻이고, 오타를 헤더로 눙치면 확장 개발자가 알아채지 못한다.
   */
  view?: string
}

export interface ExtensionView {
  id: string
  title: string
  kind: ExtensionViewKind
}

/** 확장이 앱에 얹겠다고 선언한 것들. 이 단계는 담아두기만 하고 모양만 검증한다. */
export interface ExtensionContributes {
  commands?: ExtensionCommand[]
  views?: ExtensionView[]
}

export interface ExtensionManifest {
  manifestVersion: number
  /** 설치 폴더명과 별개인 확장 식별자 */
  name: string
  /** 사람에게 보일 이름. 매니페스트에 없으면 `name` 을 쓴다 */
  displayName: string
  version: string
  /** 확장 디렉토리 기준 상대경로 */
  main: string
  /** 목록 한 줄에 실린다. 상세 창을 두지 않기로 해서 여기가 유일한 설명 자리다 */
  description?: string
  /**
   * 이 확장이 요구하는 앱 버전의 **하한**. `"^0.5.0"` 처럼 적는다.
   *
   * 지금은 **읽어두기만 하고 막지 않는다.** 비교할 앱 버전 기준이 아직 없다.
   * 상한(IntelliJ 의 `until-build`)은 받지 않는다 — 적어두면 앱이 새 버전을 낼 때마다
   * 멀쩡한 확장이 전부 죽는다 (표준 문서 §2 교훈 2).
   */
  engines?: { davis: string }
  contributes?: ExtensionContributes
}

/**
 * 매니페스트를 못 쓴 사유.
 *
 * 필드마다 따로 두는 이유: 확장 개발자가 **무엇을 빠뜨렸는지** 바로 알아야 하기 때문이다.
 * 뭉뚱그리면 사유를 돌려주는 의미가 없다.
 */
export type ManifestParseFailure =
  | 'not_object'
  | 'missing_manifest_version'
  | 'unsupported_manifest_version'
  | 'missing_name'
  | 'unsafe_name'
  | 'missing_version'
  | 'missing_main'

/**
 * `name` 이 경로 조각으로 쓰여도 안전한가.
 *
 * `name` 은 식별자이자 **설치 디렉토리명**이 된다. `../../evil` 같은 이름이 살아 있으면
 * 설치 폴더 밖으로 새는 통로가 된다 — 값이 만들어지는 이 자리에서 막는 것이 맞다.
 *
 * 막는 것: 경로 구분자(`/`·`\`) · `..` 어디에든 · 이름이 `.` 하나뿐인 것
 * (`join(base, '.')` 은 `base` 자신이 된다).
 */
const UNSAFE_NAME = /[/\\]|\.\.|^\.$/

/**
 * 이 이름을 경로 조각으로 써도 되는가.
 *
 * 매니페스트를 읽을 때만이 아니라, **화면이 넘긴 확장 이름으로 파일을 찾을 때**도
 * 같은 판정이 필요하다 (`electron/extensions/readme.ts`). 규칙을 두 곳에 쓰면
 * 언젠가 한쪽만 바뀐다.
 */
export function isSafeExtensionName(name: string): boolean {
  return name !== '' && !UNSAFE_NAME.test(name)
}

export type ManifestParseResult =
  | { ok: true; manifest: ExtensionManifest }
  | { ok: false; reason: ManifestParseFailure }

const VIEW_KINDS: ExtensionViewKind[] = ['table', 'tree', 'list', 'html']

/**
 * 파싱된 JSON 을 매니페스트로 되돌린다.
 *
 * **필수 4개(manifestVersion·name·version·main)가 없으면 확장 전체를 버리고**,
 * `contributes` 안쪽은 항목 단위로 걸러 담는다 — 명령 하나가 깨졌다고 확장 전체를
 * 못 쓰게 만들 이유가 없다.
 */
export function parseManifest(data: unknown): ManifestParseResult {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, reason: 'not_object' }
  }
  const source = asRecord(data)

  // 판을 가장 먼저 본다 — 모르는 판이면 나머지 필드의 의미도 보장할 수 없다
  const manifestVersion = source['manifestVersion']
  if (typeof manifestVersion !== 'number') {
    return { ok: false, reason: 'missing_manifest_version' }
  }
  if (!SUPPORTED_MANIFEST_VERSIONS.some((known) => known === manifestVersion)) {
    return { ok: false, reason: 'unsupported_manifest_version' }
  }

  const name = source['name']
  if (typeof name !== 'string' || name === '') return { ok: false, reason: 'missing_name' }
  if (UNSAFE_NAME.test(name)) return { ok: false, reason: 'unsafe_name' }

  const version = source['version']
  if (typeof version !== 'string' || version === '') return { ok: false, reason: 'missing_version' }

  // main 이 없으면 실행할 것이 없다 — 목록에만 뜨는 확장은 의미가 없다
  const main = source['main']
  if (typeof main !== 'string' || main === '') return { ok: false, reason: 'missing_main' }

  // displayName 은 선택이다 — 없으면 name 으로 떨어진다
  const displayName = source['displayName']
  const description = source['description']
  const engines = toEngines(source['engines'])
  const contributes = toContributes(source['contributes'])

  return {
    ok: true,
    manifest: {
      manifestVersion,
      name,
      displayName: typeof displayName === 'string' && displayName !== '' ? displayName : name,
      version,
      main,
      ...(typeof description === 'string' && description !== '' ? { description } : {}),
      ...(engines !== null ? { engines } : {}),
      ...(contributes !== null ? { contributes } : {}),
    },
  }
}

/** 하한만 받는다. 모양이 아니면 "선언 없음" 과 같게 본다 — 막는 단계가 아직 없어서다. */
function toEngines(value: unknown): { davis: string } | null {
  const davis = asRecord(value)['davis']
  return typeof davis === 'string' && davis !== '' ? { davis } : null
}

/**
 * `contributes` 는 통째로 없어도 된다 — 화면에 아무것도 얹지 않는 확장이 있을 수 있다.
 * 있는데 모양이 아니면 `null` 로 떨궈 "선언 없음" 과 같게 본다.
 */
function toContributes(value: unknown): ExtensionContributes | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const source = asRecord(value)

  const commands = source['commands']
  const views = source['views']

  return {
    ...(Array.isArray(commands)
      ? { commands: commands.map(toCommand).filter((c): c is ExtensionCommand => c !== null) }
      : {}),
    ...(Array.isArray(views)
      ? { views: views.map(toView).filter((v): v is ExtensionView => v !== null) }
      : {}),
  }
}

function toCommand(value: unknown): ExtensionCommand | null {
  const source = asRecord(value)
  const id = source['id']
  const title = source['title']
  // id 가 없으면 부를 수 없고, title 이 없으면 메뉴에 뭐라 쓸지 모른다
  if (typeof id !== 'string' || id === '') return null
  if (typeof title !== 'string' || title === '') return null
  // 모르는 자리 이름은 **없는 것으로** 본다 — 버리면 명령 자체가 사라져 눌러 볼 자리도 없어진다
  const placement = source['placement']
  // 뷰 묶기는 `header` 에만 뜻이 있다. 주 행동·`⋯` 는 아래 바에 사는데 그 바는 탭과 무관하다
  const view = source['view']
  return {
    id,
    title,
    ...(placement === 'header' || placement === 'menu' ? { placement } : {}),
    ...(placement === 'header' && typeof view === 'string' && view !== '' ? { view } : {}),
  }
}

function toView(value: unknown): ExtensionView | null {
  const source = asRecord(value)
  const id = source['id']
  const title = source['title']
  const kind = source['kind']
  if (typeof id !== 'string' || id === '') return null
  if (typeof title !== 'string' || title === '') return null
  // 앱이 못 그리는 kind 는 담아둬도 쓸 데가 없다
  if (!isViewKind(kind)) return null
  return { id, title, kind }
}

function isViewKind(value: unknown): value is ExtensionViewKind {
  return VIEW_KINDS.some((kind) => kind === value)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}
