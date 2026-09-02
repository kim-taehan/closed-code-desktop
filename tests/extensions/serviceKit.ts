import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ExtensionService } from '../../electron/extensions/service'
import type { ExtensionWorkspace } from '../../electron/extensions/workspaceApi'
import type { HostChild, HostStream } from '../../electron/extensions/host'
import { createNotice, NOTICE_READY, parseRpcMessage, type RpcMessage } from '../../electron/extensions/rpc'

// `ExtensionService` 를 **부모 쪽만** 돌리기 위한 가짜 자식 + 임시 확장 디렉토리.
//
// `service.test.ts` 와 `serviceRowEnvelope.test.ts` 가 함께 쓴다 — 겉봉 시험을 더하면서
// 300줄 상한에 걸려 갈라냈고, 그때 공용으로 뺐다
// (`tests/runtime-protocol/chatSessionKit.ts` 가 같은 자리에 있는 것과 같은 이유).

export class NullStream implements HostStream {
  on(_event: 'data', _listener: (chunk: unknown) => void): void {}
}

export class FakeChild implements HostChild {
  readonly stdout = new NullStream()
  readonly stderr = new NullStream()
  readonly sent: RpcMessage[] = []

  private toParent: ((message: unknown) => void) | null = null
  private onExit: ((code: number) => void) | null = null

  on(event: 'message', listener: (message: unknown) => void): void
  on(event: 'exit', listener: (code: number) => void): void
  on(event: 'error', listener: () => void): void
  on(event: 'message' | 'exit' | 'error', listener: (...args: never[]) => void): void {
    if (event === 'message') this.toParent = listener as (message: unknown) => void
    else if (event === 'exit') this.onExit = listener as (code: number) => void
  }

  postMessage(message: unknown): void {
    const parsed = parseRpcMessage(message)
    if (parsed) this.sent.push(parsed)
  }

  kill(): boolean {
    return true
  }

  emit(message: unknown): void {
    this.toParent?.(message)
  }

  emitExit(code: number): void {
    this.onExit?.(code)
  }

  ready(): void {
    this.emit(createNotice(NOTICE_READY, { pid: 0 }))
  }

  /** 부모가 보낸 요청 중 이 메서드의 첫 건 */
  find(method: string): RpcMessage | undefined {
    return this.sent.find((message) => message.kind === 'request' && message.method === method)
  }

  /** 부모가 보낸 이 메서드의 요청 전부 — 겹쳐 도는 명령을 세는 데 쓴다 */
  findAll(method: string): { id: string }[] {
    return this.sent.filter(
      (message): message is RpcMessage & { kind: 'request'; id: string } =>
        message.kind === 'request' && message.method === method,
    )
  }
}

/** 성한 확장 1개 + 매니페스트가 깨진 확장 1개가 든 임시 확장 디렉토리 */
export async function makeExtensionsDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ext-service-'))

  const good = join(dir, 'good')
  await mkdir(good, { recursive: true })
  await writeFile(
    join(good, 'manifest.json'),
    JSON.stringify({ manifestVersion: 2, name: 'good', version: '1.0.0', main: 'main.js' }),
    'utf8',
  )

  // 매니페스트가 깨진 확장 — 훑기 단계 사유가 나온다
  const broken = join(dir, 'broken')
  await mkdir(broken, { recursive: true })
  await writeFile(join(broken, 'manifest.json'), '{ 깨짐', 'utf8')

  return dir
}

export function makeExtensionService(
  extensionsDir: string,
  workspace: Partial<ExtensionWorkspace> = {},
): { service: ExtensionService; child: FakeChild } {
  const child = new FakeChild()
  const service = new ExtensionService({
    entryPath: 'ignored',
    fork: () => child,
    extensionsDir,
    workspace: workspace as ExtensionWorkspace,
  })
  return { service, child }
}
