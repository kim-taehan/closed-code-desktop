import { lstat, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { describeError } from '../../shared/errors/describeError'
import { resolveInside } from '../fs/resolveInside'
import type { ExtensionManifest } from '../../shared/extensions/manifest'
import type { ExtensionApi } from './extensionApi'

// 확장 호스트(자식) 안에서 확장을 실제로 싣는다.
//
// **하나가 실패해도 나머지는 산다.** 확장은 폴더 복사로 설치되므로 하나가 깨진 채
// 들어오는 것이 정상 범위다 — 거기서 전체를 포기하면 멀쩡한 확장까지 사라진다.
// registry 가 매니페스트 단계의 사유를 돌려주는 것과 같은 이유로, 여기도 사유를 돌려준다.
//
// `main.js` 를 require 하기 전에 **반드시 resolveInside 를 태운다** — 안 그러면
// `"main": "../../evil.js"` 가 그대로 열린다. 판정 주체는 `electron/fs/resolveInside.ts`
// 하나이고, 이 파일은 그 결과만 읽는다.

/** 확장 하나를 못 실은 사유. registry 의 매니페스트 단계 사유 뒤에 오는 것들이다. */
export type ExtensionLoadFailure =
  /** main 이 확장 디렉토리 밖을 가리킨다 */
  | 'main_outside'
  /** main 이 가리키는 파일이 없다 */
  | 'main_missing'
  /** main 이 파일이 아니다 (디렉토리·확장 디렉토리 자신). require 하면 엉뚱한 index 로 간다 */
  | 'main_not_file'
  /** require 가 던졌다 (문법 오류·최상위 예외) */
  | 'require_failed'
  /** activate 를 export 하지 않았다 */
  | 'no_activate'
  /** activate 가 던졌다 */
  | 'activate_failed'

export interface ExtensionSource {
  dir: string
  manifest: ExtensionManifest
}

export interface ExtensionLoadFailed {
  dir: string
  reason: ExtensionLoadFailure
  /** require·activate 가 던진 원문. 사유만으로는 고칠 수 없어 같이 올린다. */
  detail?: string
}

/**
 * 명령 처리기.
 *
 * 인자는 **사용자가 화면에서 고른 것**이다 (트리 체크박스·목록 선택). 확장 화면에서
 * 확장으로 가는 메시지 통로를 열지 않고 선택을 전하는 길이라, 조작 알갱이가 명령 단위로
 * 유지된다. 고른 것이 없거나 그런 화면이 아니면 `undefined` 다.
 */
export type CommandHandler = (selection?: unknown) => unknown

/**
 * 명령표의 값. **처리기와 주인을 함께 든다.**
 *
 * 주인을 같이 두는 이유: 이 표는 확장 전부가 나눠 쓰는 한 장이라 id 만으로는 누구 것인지
 * 알 수 없다. 확장 화면에서 온 명령(`data-command`)은 「누구의 화면인가」가 함께 오므로,
 * 자식이 여기 적힌 주인과 대조해 남의 명령을 거부한다 (`childHandlers.ts`).
 */
export interface RegisteredCommand {
  extension: string
  handler: CommandHandler
}

/**
 * 다시 그리기 처리기. 인자가 없다 — 확장은 `storage` 가 이미 활성 프로젝트로 풀리므로
 * 어느 프로젝트인지 따로 받을 것이 없다 (`hostPorts.ts` 의 `activeWhenUnknown`).
 */
export type RedrawHandler = () => unknown

/**
 * 활성 파일 처리기. 편집기에서 **보고 있는 파일이 바뀔 때마다** 불린다.
 *
 * `RedrawHandler` 와 따로 두는 이유는 `rpc.ts` 의 `METHOD_ACTIVE_FILE` 머리말에 있다 —
 * 「다시 그려라」와 「보는 것이 바뀌었다」를 섞으면 확장이 **왜 불렸는지 모른다.**
 *
 * 아무것도 안 보고 있으면(대화 탭 등) `null` 이 온다. **빈 객체를 만들지 않는다** —
 * 「파일이 없다」와 「경로를 못 읽었다」가 같아진다.
 */
export type ActiveFileHandler = (file: ActiveFileRef | null) => unknown

/** 지금 보고 있는 것. 커서 줄은 **1-based** 다 (`src/state/editorContext.ts` 와 같은 규약). */
export interface ActiveFileRef {
  /** 프로젝트 루트 상대 경로. 절대 경로 변환은 main 이 한다. */
  path: string
  line?: number
}

/**
 * 확장 하나에 줄 `code` 를 만든다.
 *
 * **확장마다 따로 만든다.** 하나를 돌려 쓰면 `storage` 가 어느 확장 것인지 알 수 없어
 * 키가 확장끼리 충돌한다 (`extensionApi.ts` 의 `METHOD_STORAGE_GET` 머리말).
 */
/** 두 번째 인자는 **사람이 읽는 이름**(`displayName`) — 물음창에만 쓴다 (`extensionApi.ts`) */
export type ExtensionApiFor = (extensionName: string, extensionLabel: string) => ExtensionApi

export interface ExtensionLoadResult {
  /** 명령 id → 처리기와 주인. 확장 여러 개가 같은 id 를 선언하면 먼저 실린 쪽이 남는다. */
  commands: Map<string, RegisteredCommand>
  /** `activate` 가 `redraw` 를 돌려준 확장들. 선언 순서대로 돈다 */
  redraws: RedrawHandler[]
  /** `activate` 가 `onActiveFile` 을 돌려준 확장들. 선언 순서대로 돈다 */
  activeFiles: ActiveFileHandler[]
  /** 실린 확장의 `manifest.name` */
  loaded: string[]
  failed: ExtensionLoadFailed[]
}

/** `require` 주입점. host.ts 의 `fork` 와 같은 이유다 — 가짜 모듈로 테스트가 돈다. */
export type RequireModule = (absolutePath: string) => unknown

export interface LoadDeps {
  requireModule: RequireModule
  /** 로그 한 줄. 자식의 stdout/stderr 는 부모가 앱 로그창으로 흘린다. */
  log?: (line: string) => void
}

/**
 * 확장들을 싣고 명령표를 만든다.
 *
 * **activationEvents 를 아직 보지 않는다** — 지금은 전부 즉시 activate 한다.
 * 지연 활성화는 "명령이 불릴 때 그 확장만 깨운다" 는 별도 기능이고,
 * 확장 수가 한 자리인 지금은 값이 없다 (계획서 §4 "미루는 것" 결).
 */
export async function loadExtensions(
  sources: ExtensionSource[],
  apiFor: ExtensionApiFor,
  deps: LoadDeps,
): Promise<ExtensionLoadResult> {
  const commands = new Map<string, RegisteredCommand>()
  const redraws: RedrawHandler[] = []
  const activeFiles: ActiveFileHandler[] = []
  const loaded: string[] = []
  const failed: ExtensionLoadFailed[] = []

  for (const source of sources) {
    // 🚨 로드 경로는 **이 반환값뿐이다.** `manifest.main` 원문을 다시 경로로 쓰면
    // "루트 안" 보증이 그 자리에서 사라진다 (`_workspace/46` 결함 #5).
    const entry = await resolveInside(source.dir, source.manifest.main)
    if (entry === null) {
      failed.push({ dir: source.dir, reason: await describeMainFailure(source.dir, source.manifest.main) })
      continue
    }

    // resolveInside 는 **디렉토리를 통과시킨다** (`46` 재생표 4행: `resolveInside(root,'lib')` → `root/lib`).
    // `main: ''` 이면 확장 디렉토리 자신이 나온다 — require 하면 그 안의 index.js 로 새어 간다.
    // 파서가 빈 문자열을 막지만(`missing_main`), 여기서도 막아 두 겹으로 둔다 (`46` 강제사항 D·E).
    if (!(await isFile(entry))) {
      failed.push({ dir: source.dir, reason: 'main_not_file' })
      continue
    }

    let module: unknown
    try {
      module = deps.requireModule(entry)
    } catch (error) {
      failed.push({ dir: source.dir, reason: 'require_failed', detail: describeError(error) })
      continue
    }

    const activate = asRecord(module)['activate']
    if (typeof activate !== 'function') {
      failed.push({ dir: source.dir, reason: 'no_activate' })
      continue
    }

    try {
      // 확장이 async activate 를 써도 되게 await 한다 — 동기 반환이면 그대로 통과한다
      const registration = await (activate as (api: ExtensionApi) => unknown)(apiFor(source.manifest.name, source.manifest.displayName))
      addCommands(commands, registration, source, deps.log)
      const redraw = asRecord(registration)['redraw']
      // 안 돌려줘도 된다 — 저장할 것이 없는 확장은 다시 그릴 것도 없다
      if (typeof redraw === 'function') redraws.push(redraw as RedrawHandler)
      const onActiveFile = asRecord(registration)['onActiveFile']
      // 안 돌려줘도 된다 — 활성 파일을 안 보는 확장이 대부분이다
      if (typeof onActiveFile === 'function') activeFiles.push(onActiveFile as ActiveFileHandler)
      loaded.push(source.manifest.name)
    } catch (error) {
      failed.push({ dir: source.dir, reason: 'activate_failed', detail: describeError(error) })
    }
  }

  return { commands, redraws, activeFiles, loaded, failed }
}

/** activate 가 돌려준 `{ commands: { id: fn } }` 를 명령표에 담는다. 없어도 된다. */
function addCommands(
  commands: Map<string, RegisteredCommand>,
  registration: unknown,
  source: ExtensionSource,
  log?: (line: string) => void,
): void {
  const declared = asRecord(asRecord(registration)['commands'])
  for (const [id, handler] of Object.entries(declared)) {
    if (typeof handler !== 'function') continue
    if (commands.has(id)) {
      // 조용히 덮으면 어느 확장이 도는지 알 수 없게 된다. 먼저 실린 쪽을 남기고 알린다.
      log?.(`[확장] 명령 id 충돌로 건너뜀: ${id} (${source.manifest.name})`)
      continue
    }
    commands.set(id, { extension: source.manifest.name, handler: handler as CommandHandler })
  }
}

/**
 * 사유 이름만 고른다. **허용 판정은 이미 끝났다** — 여기 오는 것은 `resolveInside` 가
 * null 을 준 것뿐이고, 이 함수는 무엇도 허용하지 않는다.
 *
 * 가르는 이유(`_workspace/46` 강제사항 C): `resolveInside` 의 null 은 "밖" 과 "없는 파일" 을
 * 합치는데, 확장 개발자가 고칠 방법이 정반대다 — **파일명을 고치는 일**과 **확장을 지우는 일**.
 * `resolveInside` 의 계약은 건드리지 않는다 (`ProjectFs` 회귀 위험).
 *
 * 순서가 중요하다:
 * 1. **문자열 계산으로 먼저 가른다.** `..`·절대경로가 여기서 걸린다. 파일시스템을 안 만지므로
 *    `45` §QA-2 가 경고한 "절대경로가 없는 경로가 되어 realpath 가 던진다" 는 간접 성질에
 *    기대지 않는다. 반대로 `stat` 부터 하면 `/tmp/evil.js` 가 `dir/tmp/evil.js`(없음)로 보여
 *    **탈출이 오타로 둔갑한다.**
 * 2. 문자열상 안쪽인데도 거부됐다면 남은 경우는 하나다 — **심링크가 밖을 가리킨다.**
 *    여기서만 `lstat` 을 쓴다. 대상이 문자열상 확장 디렉토리 안이라 **밖을 훑지 않는다.**
 */
async function describeMainFailure(dir: string, main: string): Promise<'main_outside' | 'main_missing'> {
  if (isAbsolute(main)) return 'main_outside'
  if (relative(dir, resolve(dir, main)).startsWith('..')) return 'main_outside'

  try {
    // 링크 자체를 본다 — realpath 를 따라가면 resolveInside 가 이미 거부한 판정을 되풀이할 뿐이다
    await lstat(resolve(dir, main))
    return 'main_outside'
  } catch {
    return 'main_missing'
  }
}

/** 디렉토리·없는 경로는 false. 열 수 없는 것도 실을 수 없으므로 같게 본다. */
async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}
