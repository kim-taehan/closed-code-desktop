import { describeError } from '../../shared/errors/describeError'
import { METHOD_LOAD_EXTENSIONS } from './rpc'
import { toSkips } from './serviceParse'
import { defaultExtensionsDir, scanExtensions, type ExtensionScan, type SkippedExtension } from './registry'
import { disabledNames, onlyEnabled, withEnabled, type ListedExtension } from './serviceEnabled'
import type { ExtensionLoadFailed } from './extensionLoader'

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
  extensions: ListedExtension[]
  skipped: ExtensionSkip[]
}

export interface ExtensionLoaderDeps {
  /** 기본값은 `~/.open-code/desktop-extensions` */
  extensionsDir?: string
  /**
   * 꺼 둔 확장 이름. 부를 때마다 읽는다 — 설정은 앱이 도는 중에 바뀐다.
   * 값이 아니라 함수인 이유는 `ExtensionServiceOptions` 쪽 머리말에 있다.
   */
  disabledNames?: () => Promise<readonly string[]>
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
   */
  async listing(): Promise<ExtensionListing> {
    const scan = await this.scan()
    return {
      extensions: withEnabled(scan.extensions, await this.disabled()),
      skipped: [...scan.skipped, ...this.loadFailures],
    }
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
    const enabled = onlyEnabled(scan.extensions, await this.disabled())

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

  private disabled(): Promise<ReadonlySet<string>> {
    return disabledNames(this.deps.disabledNames, (message) => this.deps.log(`[확장] ${message}`))
  }

  /** 못 실은 확장을 사유와 함께 로그로 남긴다. 빈 목록이면 아무것도 찍지 않는다. */
  private report(skips: ExtensionSkip[], label: string): void {
    for (const skip of skips) {
      this.deps.log(`[확장] ${label} ${skip.dir}: ${skip.reason}${skip.detail ? ` — ${skip.detail}` : ''}`)
    }
  }
}
