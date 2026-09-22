import { describeError } from '../../shared/errors/describeError'
import { METHOD_LOAD_EXTENSIONS } from './rpc'
import { toSkips } from './serviceParse'
import { defaultExtensionsDir, scanExtensions, type ExtensionScan, type SkippedExtension } from './registry'
import { installedNames, onlyEnabled, withEnabled, type ListedExtension } from './serviceEnabled'
import type { ProjectExtensionsPort } from './projectExtensions'
import type { ExtensionLoadFailed } from './extensionLoader'
import type { ExtensionManifest } from '../../shared/extensions/manifest'

// `ExtensionService` 가 하는 셋 중 **첫 둘** — 훑기(registry) → 자식에 실으라고 넘기기 —
// 만 떼어 왔다. 셋째(자식이 부르는 code.* 를 대신 수행)는 저쪽에 남는다.
//
// 여기가 경계인 이유: 이 둘만이 **"무엇이 목록에 있고 왜 없나" 라는 하나의 질문**에 답한다.
// 훑기 사유와 싣기 사유가 갈라져 있으면 사용자에게는 "복사했는데 안 뜬다" 로만 보이므로
// 둘을 합쳐 답하는 자리가 반드시 하나 있어야 한다 (`listing()`).
//
// **수명 정책은 여기에 없다.** 언제 다시 훑고 언제 다시 싣는지는 `ExtensionService` 가
// 정하고, 이 클래스는 `forgetScan`/`forgetFailures` 로 그 지시를 받기만 한다 —
// `reload` 와 `restart` 가 **서로 다른 것을 잊는다는 사실**이 저쪽의 판단이기 때문이다.

/** 훑기 단계 사유 + 싣기 단계 사유. 사람에게 "왜 안 뜨는지" 를 끝까지 알려주려면 둘 다 필요하다. */
export interface ExtensionSkip {
  dir: string
  reason: SkippedExtension['reason'] | ExtensionLoadFailed['reason']
  detail?: string
}

export interface ExtensionListing {
  /** `enabled` 는 **`activeProject` 에서** 켜졌는가다 */
  extensions: ListedExtension[]
  skipped: ExtensionSkip[]
  /** 켜짐의 기준 프로젝트 (지금 활성). 없으면 null 이고 그때는 전부 꺼진 것으로 온다 */
  activeProject: { id: string; name: string } | null
}

export interface ExtensionLoaderDeps {
  /** 기본값은 `~/.open-code/desktop-extensions` */
  extensionsDir?: string
  /**
   * 프로젝트마다 켠 확장 (`projectExtensions.ts`). 부를 때마다 묻는다 — 켜고 끄는 것도
   * 활성 프로젝트도 앱이 도는 중에 바뀐다.
   *
   * **안 주면 어디서나 전부 켜진 것으로 친다** (확장 레포의 시험이 이렇게 띄운다).
   * 앱은 늘 준다 (`appHost.ts`).
   */
  projects?: ProjectExtensionsPort
  /** 자식에 거는 요청. `ExtensionHost.request` 를 그대로 받는다. */
  request(method: string, params?: unknown): Promise<unknown>
  /** 앱 로그창으로 흘리는 통로 */
  log(line: string): void
}

export class ExtensionLoader {
  private readonly extensionsDir: string
  private scanning: Promise<ExtensionScan> | null = null
  private loadFailures: ExtensionSkip[] = []

  constructor(private readonly deps: ExtensionLoaderDeps) {
    this.extensionsDir = deps.extensionsDir ?? defaultExtensionsDir()
  }

  /** 다음 훑기 때 디스크를 다시 본다 (설치가 끝난 뒤). */
  forgetScan(): void {
    this.scanning = null
  }

  /** 싣기 실패 기록을 버린다. **자식을 갈아끼울 때만** — 새 자식은 그 실패를 안 겪었다. */
  forgetFailures(): void {
    this.loadFailures = []
  }

  /**
   * 훑기 결과 + 싣기 실패를 합친 목록. 화면·IPC 가 이걸 그대로 쓴다.
   *
   * **꺼 둔 확장도 여기 남는다.** 목록에서까지 사라지면 다시 켤 방법이 없다.
   * 켜짐은 **활성 프로젝트** 기준이다 — 목록을 보는 사람은 그 프로젝트를 보고 있다.
   */
  async listing(): Promise<ExtensionListing> {
    const scan = await this.scan()
    const projects = this.deps.projects
    const activeProject = projects?.active() ?? null
    const installed = installedNames(scan.extensions)
    return {
      extensions: withEnabled(
        scan.extensions,
        projects ? await projects.enabledIn(activeProject?.id ?? null, installed) : new Set(installed),
      ),
      skipped: [...scan.skipped, ...this.loadFailures],
      activeProject,
    }
  }

  /**
   * 그 프로젝트에 켜진 이름 — 명령을 거는 쪽이 자식에 실어 보내 거절을 받는다 (`serviceInvoke.ts`).
   * 정책이 배선되지 않았으면 `undefined`(= 확인하지 않는다).
   */
  async allowedIn(projectId: string | null): Promise<string[] | undefined> {
    if (!this.deps.projects) return undefined
    const installed = installedNames((await this.scan()).extensions)
    return [...(await this.deps.projects.enabledIn(projectId, installed))]
  }

  /**
   * 웹뷰 탭 하나를 띄울 재료 — 설치 폴더·문서 자리·제목. **그 프로젝트에 켜진 3판 웹뷰**만 준다.
   *
   * 판정을 여기 두는 이유: 설치 목록(훑기)과 켜짐(`allowedIn`)을 둘 다 아는 곳이 여기뿐이다.
   * 파일이 실제로 있는지·`ui/` 밖인지는 서빙하는 쪽(`uiServer.open`)이 본다.
   */
  async webview(
    extension: string,
    viewId: string,
    projectId: string,
  ): Promise<{ ok: true; dir: string; entry: string; title: string } | { ok: false; reason: string }> {
    const found = (await this.scan()).extensions.find((one) => one.manifest.name === extension)
    if (found === undefined) return { ok: false, reason: `설치되지 않은 확장입니다: ${extension}` }
    const allowed = await this.allowedIn(projectId)
    if (allowed !== undefined && !allowed.includes(extension)) {
      return { ok: false, reason: `이 프로젝트에서 켜지 않은 확장입니다: ${extension} — 설정의 확장에서 켜세요` }
    }
    const view = found.manifest.contributes?.views?.find((one) => one.id === viewId)
    if (view?.kind !== 'webview' || view.entry === undefined) {
      return { ok: false, reason: `${extension} 확장에 웹뷰 화면 ${viewId} 가 없습니다` }
    }
    return { ok: true, dir: found.dir, entry: view.entry, title: view.title }
  }

  /**
   * 그 이름의 매니페스트 (훑기 결과). 판(저장소 규칙, G-2)과 `network`(http 허용 목록)를 main 이 여기서 읽는다 —
   * 자식이 실어 보낸 값을 믿으면 확장이 자기 허용 목록을 부풀린다. 모르는 이름이면 `undefined`.
   */
  async manifest(extension: string): Promise<ExtensionManifest | undefined> {
    return (await this.scan()).extensions.find((one) => one.manifest.name === extension)?.manifest
  }

  async loadAll(): Promise<void> {
    const scan = await this.scan()
    // 훑기 단계 사유를 여기서 **반드시 흘린다.** 안 그러면 사유가 반환값까지만 살고 아무도 안 읽어,
    // 사용자에게는 "복사했는데 안 뜬다" 로만 끝난다 (`_workspace/46` 결함 #3 = 강제사항 F).
    // 화면 노출은 다음 단계(IPC)가 하고, 여기서는 앱 로그창까지 보낸다.
    this.report(scan.skipped.map((skip) => ({ dir: skip.dir, reason: skip.reason })), '건너뜀')

    // ponytail: 꺼도 **이미 실린 코드는 여기서 멈추지 않는다** — 자식의 require 캐시에 남은
    // 모듈이 걸어 둔 타이머·리스너는 앱을 껐다 켤 때까지 돈다. 확실히 멈추려면 자식을
    // 다시 띄워야 하는데 그러면 다른 확장이 쥔 상태까지 날아간다 (`reload` 와 같은 판단).
    //
    // 호스트는 앱에 하나라 **어느 프로젝트에서든 켜진 것을** 싣는다(합집합). 켜지 않은
    // 프로젝트에서 부르는 것은 명령을 걸 때 막는다 (`allowedIn`).
    const installed = installedNames(scan.extensions)
    const enabled = onlyEnabled(
      scan.extensions,
      this.deps.projects ? await this.deps.projects.enabledAnywhere(installed) : new Set(installed),
    )

    try {
      const result = await this.deps.request(METHOD_LOAD_EXTENSIONS, { extensions: enabled })
      this.loadFailures = toSkips(result)
      this.report(this.loadFailures, '싣기 실패')
    } catch (error) {
      // 호스트가 죽었거나 답이 깨졌다. 목록은 훑기 결과만 남고 명령은 전부 거부된다.
      this.deps.log(`[확장] 싣기 요청 실패: ${describeError(error)}`)
    }
  }

  /** 훑기는 한 번만 한다 — 실린 것은 자식 안에 이미 고정돼 있어 다시 훑으면 목록이 거짓말을 한다. */
  private scan(): Promise<ExtensionScan> {
    this.scanning ??= scanExtensions(this.extensionsDir)
    return this.scanning
  }

  /** 못 실은 확장을 사유와 함께 로그로 남긴다. 빈 목록이면 아무것도 찍지 않는다. */
  private report(skips: ExtensionSkip[], label: string): void {
    for (const skip of skips) {
      this.deps.log(`[확장] ${label} ${skip.dir}: ${skip.reason}${skip.detail ? ` — ${skip.detail}` : ''}`)
    }
  }
}
