import { describeError } from '../../shared/errors/describeError'
import { HandlerSet, type Unsubscribe } from '../ws/transport'
import { ViewEmitters } from './viewEmitters'
import { ExtensionHost, type ForkFn } from './host'
import { errorResponse, METHOD_LOAD_EXTENSIONS, NOTICE_READY, okResponse, type RpcRequest } from './rpc'
import { ProjectEnvelope } from './projectEnvelope'
import { ViewOwnership } from './viewOwnership'
import { createInvoker, type Invoker } from './serviceInvoke'
import { toSkips } from './serviceParse'
import { dispatchExtensionApi, portsOf, type DispatchPorts } from './serviceDispatch'
import { defaultExtensionsDir, scanExtensions, type ExtensionScan, type SkippedExtension } from './registry'
import { disabledNames, onlyEnabled, withEnabled, type ListedExtension } from './serviceEnabled'
import type { ExtensionLoadFailed } from './extensionLoader'
import type { ExtensionProgressPayload } from '../../shared/ipc/extensionPayloads'

// main 쪽 확장 진입점. 바깥(IPC 배선·메뉴)이 확장에 닿는 유일한 표면이다.
//
// 하는 일은 셋이다:
//   훑기(registry) → 자식에 실으라고 넘기기 → 자식이 부르는 code.* 를 대신 수행
//
// **호스트 수명은 여기서 정책을 갖지 않는다** — 기동·종료·크래시는 ExtensionHost 것이고,
// 이 클래스는 그 위에 "무엇을 싣고 무엇을 답할지" 만 얹는다 (host.ts 머리말과 같은 경계).

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

/**
 * 확장 API 를 뒤에서 받쳐 주는 배선(`DispatchPorts`)을 그대로 물려받는다 —
 * 여기서 다시 세면 포트가 늘 때마다 두 곳을 고쳐야 하고, 한쪽만 고치면 조용히 거부된다.
 */
export interface ExtensionServiceOptions extends DispatchPorts {
  /** hostEntry.js 의 절대 경로 */
  entryPath: string
  fork: ForkFn
  /** 기본값은 `~/.open-code/desktop-extensions` */
  extensionsDir?: string
  /**
   * 꺼 둔 확장 이름. 부를 때마다 읽는다 — 설정은 앱이 도는 중에 바뀐다.
   *
   * 함수로 받는 이유는 `activeProjectId` 와 같다. 값으로 받으면 끄고 켠 것이
   * 다음 앱 실행에나 반영된다.
   */
  disabledNames?: () => Promise<readonly string[]>
}

export class ExtensionService {
  private readonly host: ExtensionHost
  private readonly extensionsDir: string
  /** 뷰로 올라온 것들(행·화면·트리). 겉봉 규칙이 같아 한곳에 모아 뒀다. */
  private readonly views = new ViewEmitters()
  private readonly logHandlers = new HandlerSet<[string]>()
  /** 결과 행·트리·화면에 붙일 프로젝트 겉봉. 규칙은 `projectEnvelope.ts` 에 있다. */
  private readonly envelope = new ProjectEnvelope()
  private readonly ownership = new ViewOwnership() // redraw 가 남의 프로젝트 화면을 나르지 않게 — 규칙은 viewOwnership.ts
  private scanning: Promise<ExtensionScan> | null = null
  private loadFailures: ExtensionSkip[] = []
  /** 싣기가 끝났는가. 목록·명령이 이걸 기다린다 — 안 기다리면 기동 직후 호출이 빈손으로 돌아온다. */
  private loaded: Promise<void> | null = null
  private markReady: (() => void) | null = null
  /** 자식에 거는 세 가지(명령·다시그리기·활성파일). 사유와 겉봉 규칙은 `serviceInvoke.ts` 에 있다. */
  private readonly invoke: Invoker

  constructor(private readonly options: ExtensionServiceOptions) {
    this.host = new ExtensionHost({ entryPath: options.entryPath, fork: options.fork })
    this.extensionsDir = options.extensionsDir ?? defaultExtensionsDir()
    this.invoke = createInvoker({
      request: (method, params) => this.host.request(method, params),
      during: (projectId, work) => this.envelope.during(projectId, work),
    })
  }

  start(): void {
    // 자식이 떴다는 신호를 기다렸다가 싣는다. 그전에 보내면 리스너가 없어 사라진다.
    this.loaded = new Promise<void>((resolve) => {
      this.markReady = resolve
    }).then(() => this.loadAll())

    this.host.onLog((line) => this.logHandlers.emit(line))
    this.host.onMessage((message) => {
      if (message.kind === 'notice' && message.method === NOTICE_READY) this.markReady?.()
      if (message.kind === 'request') void this.serve(message)
    })
    // 호스트가 떠보지도 못하고 죽으면 ready 가 영영 안 온다. 그 자리에서 풀어준다 —
    // 안 풀면 listExtensions()/runCommand() 를 부른 쪽이 영원히 기다린다.
    this.host.onExit(() => this.markReady?.())
    this.host.start()
  }

  /**
   * 훑기 결과 + 싣기 실패를 합친 목록. 화면·IPC 가 이걸 그대로 쓴다.
   *
   * **꺼 둔 확장도 여기 남는다.** 목록에서까지 사라지면 다시 켤 방법이 없다.
   */
  async listExtensions(): Promise<ExtensionListing> {
    await this.settled()
    const scan = await this.scan()
    return {
      extensions: withEnabled(scan.extensions, await this.disabled()),
      skipped: [...scan.skipped, ...this.loadFailures],
    }
  }

  /**
   * 디스크를 **다시 훑어 다시 싣는다.** 설치가 끝난 뒤에 부른다.
   *
   * 이것이 없으면 새로 설치한 확장은 **앱을 껐다 켜야** 보인다 — `scan()` 이 한 번만 훑기
   * 때문이다. 사용자에게는 "설치했는데 목록에 없다" 로만 보이고, 어디에도 사유가 남지 않는다.
   *
   * 자식은 `METHOD_LOAD_EXTENSIONS` 를 받으면 명령표를 **통째로 갈아끼운다**
   * (`childHandlers.ts`). 그래서 지우기·되돌리기 없이 목록 전체를 다시 넘기면 된다.
   *
   * ponytail: **이미 실린 확장의 코드는 갱신되지 않는다** — 자식의 `require` 캐시가
   * 옛 모듈을 그대로 돌려준다. 새로 설치한 확장은 캐시에 없어 정상이고, 같은 확장을
   * 덮어쓴 경우(업데이트)에만 재시작이 필요하다. 캐시를 비우려면 자식을 다시 띄워야 하는데,
   * 그러면 다른 확장이 쥐고 있던 상태까지 함께 날아간다 — 그 값을 치를 이유가 아직 없다.
   */
  async reload(): Promise<void> {
    // 기동 직후 첫 싣기와 겹치면 두 번 싣게 된다. 앞엣것이 끝난 뒤에 다시 훑는다.
    await this.settled()
    this.scanning = null
    this.loaded = this.loadAll()
    await this.loaded
  }

  /**
   * **자식을 갈아 끼운다.** `reload` 로는 안 되는 한 가지 — 덮어쓴 확장의 새 코드 —
   * 때문에 있다. 자식의 `require` 캐시가 옛 모듈을 그대로 돌려주므로, 같은 확장을
   * 업데이트하면 목록의 버전만 올라가고 동작은 옛것으로 남는다.
   *
   * **치르는 값:** 모든 확장의 메모리 상태와 진행 중이던 명령이 함께 날아간다. 그래서
   * 아무 때나 부르지 않는다 — 덮어쓴 설치에서만 부른다 (`extensionManageHandlers`).
   * 이미 화면에 그려진 결과 행은 renderer 가 쥐고 있어 지워지지 않는다.
   *
   * 같은 `ExtensionHost` 객체를 그대로 다시 쓴다. 자식이 나가면 `handleExit` 이
   * 안을 비우고(`host.ts`), 로그·메시지 구독은 `dispose` 에서만 풀리므로 배선이 살아 있다.
   */
  async restart(): Promise<void> {
    // 먼저 내보낸다. 순서를 바꿔 새 약속을 먼저 걸면 **그 종료 신호가 곧바로 그것을 깨워**
    // 자식이 뜨기도 전에 싣기를 시작한다.
    await this.host.stop()

    this.scanning = null
    this.loadFailures = []
    this.ownership.clear() // 저장된 화면이 자식과 함께 죽었다 — 옛 주인 기록이 새 redraw 를 막으면 안 된다
    this.loaded = new Promise<void>((resolve) => {
      this.markReady = resolve
    }).then(() => this.loadAll())

    // `start` 가 아니라 `respawn` 이다 — 유예 시간을 넘겨 kill 로 갔다면 자식 자리가
    // 아직 차 있어 `start()` 는 "이미 실행 중" 으로 던진다 (`host.respawn` 머리말).
    this.host.respawn()
    await this.loaded
  }

  // 아래 셋은 `serviceInvoke.ts` 에 위임한다. **여기서 하는 일은 `settled()` 하나** —
  // 싣기가 끝나기 전에 걸면 자식에 명령표가 없어 빈손으로 거부된다.

  async runCommand(
    commandId: string,
    projectId: string | null,
    selection?: unknown,
    extension?: string,
  ): Promise<void> {
    await this.settled()
    await this.invoke.runCommand(commandId, projectId, selection, extension)
  }

  async redraw(projectId: string | null): Promise<void> {
    await this.settled()
    await this.ownership.duringRedraw(() => this.invoke.redraw(projectId))
  }

  async activeFileChanged(file: unknown, projectId: string | null): Promise<void> {
    await this.settled()
    await this.invoke.activeFileChanged(file, projectId)
  }

  /**
   * 확장이 `code.view.setRows` 로 넘긴 행. 화면 쪽이 여기에 붙는다.
   *
   * 세 번째 인자는 그 행을 낸 명령의 프로젝트다 (`commandProjectId`).
   */
  onViewRows(handler: (viewId: string, rows: unknown[], projectId: string | null) => void): Unsubscribe {
    return this.views.rows.add(handler)
  }

  /** 확장이 `code.view.setHtml` 로 넘긴 화면. **날 것 그대로 흘린다** — 격리는 renderer 몫이다. */
  onViewHtml(handler: (viewId: string, html: string, projectId: string | null) => void): Unsubscribe {
    return this.views.html.add(handler)
  }

  /**
   * 확장이 `code.progress` 로 알린 진행 상황. 오래 걸리는 명령이 살아 있음을 말하는 통로다.
   * 뷰 id 가 없다 — 확장 하나에 한 줄이다. 주인(`extension`)은 payload 안에 있다.
   */
  onProgress(handler: (payload: ExtensionProgressPayload, projectId: string | null) => void): Unsubscribe {
    return this.views.progress.add(handler)
  }

  /** 확장이 `code.view.setTree` 로 넘긴 트리. 그리기도 **선택 상태도** renderer 가 쥔다. */
  onViewTree(handler: (viewId: string, nodes: unknown[], projectId: string | null) => void): Unsubscribe {
    return this.views.tree.add(handler)
  }

  onLog(handler: (line: string) => void): Unsubscribe {
    return this.logHandlers.add(handler)
  }

  onExit(handler: (code: number) => void): Unsubscribe {
    return this.host.onExit(handler)
  }

  dispose(): void {
    // 정리는 exit 을 내지 않는다 — 기다리던 쪽을 먼저 풀어주고 거둔다
    this.markReady?.()
    this.host.dispose()
    this.views.clear()
    this.logHandlers.clear()
  }

  /** 싣기가 끝날 때까지 기다린다. start() 전이면 기다릴 것이 없다. */
  private async settled(): Promise<void> {
    if (this.loaded) await this.loaded
  }

  /** 훑기는 한 번만 한다 — 실린 것은 자식 안에 이미 고정돼 있어 다시 훑으면 목록이 거짓말을 한다. */
  private scan(): Promise<ExtensionScan> {
    this.scanning ??= scanExtensions(this.extensionsDir)
    return this.scanning
  }

  private disabled(): Promise<ReadonlySet<string>> {
    return disabledNames(this.options.disabledNames, (message) =>
      this.logHandlers.emit(`[확장] ${message}`),
    )
  }

  private async loadAll(): Promise<void> {
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
      const result = await this.host.request(METHOD_LOAD_EXTENSIONS, { extensions: enabled })
      this.loadFailures = toSkips(result)
      this.report(this.loadFailures, '싣기 실패')
    } catch (error) {
      // 호스트가 죽었거나 답이 깨졌다. 목록은 훑기 결과만 남고 명령은 전부 거부된다.
      this.logHandlers.emit(`[확장] 싣기 요청 실패: ${describeError(error)}`)
    }
  }

  /** 못 실은 확장을 사유와 함께 로그로 남긴다. 빈 목록이면 아무것도 찍지 않는다. */
  private report(skips: ExtensionSkip[], label: string): void {
    for (const skip of skips) {
      this.logHandlers.emit(`[확장] ${label} ${skip.dir}: ${skip.reason}${skip.detail ? ` — ${skip.detail}` : ''}`)
    }
  }

  /** 자식이 부른 code.* 를 대신 수행하고 반드시 답한다 — 답을 빠뜨리면 확장의 await 가 영원히 걸린다. */
  private async serve(request: RpcRequest): Promise<void> {
    try {
      this.host.respond(
        okResponse(
          request.id,
          await dispatchExtensionApi(
            portsOf(this.options, {
              ...this.ownership.guard(this.views.bindings(() => this.envelope.current())),
              // 응답으로 못 보내는 것들의 통로.
              // 자식이 죽었으면 `notify` 가 false 를 돌려주는데, 곁가지라 그냥 흘린다.
              notifyChild: (method, params) => {
                this.host.notify(method, params)
              },
            }),
            request,
          ),
        ),
      )
    } catch (error) {
      this.host.respond(errorResponse(request.id, describeError(error)))
    }
  }
}
