import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Channel } from '../../shared/ipc/channels'
import type { GitState } from '../../shared/git/gitState'
import type { GitStatePayload } from '../../shared/ipc/gitPayloads'
import { runGit } from '../git/gitRunner'

// 소스 관리 핸들러 테스트의 **판**. `gitBridge.test.ts` 가 300줄 상한에 닿아 갈라졌고,
// 갈라진 두 파일이 같은 판을 써야 해서 여기로 뽑았다 (선례: `extensions/testZip.ts`).
//
// **가짜는 electron 하나뿐이다.** 저장소도 레지스트리도 진짜다 — 브리지가 무엇을 답하는지는
// 진짜 git 에 대고 물어야만 드러난다 (`gitBridge.test.ts` 머리말이 근거).

/** 등록된 IPC 핸들러. `register()` 가 채우고 `call()` 이 꺼내 부른다. */
export const handlers = new Map<string, (...args: unknown[]) => unknown>()
/** 창으로 밀려나간 것. **행동 뒤에 무엇을 미는가**가 이 테스트들의 절반이다. */
export const sent: { channel: string; payload: unknown }[] = []
/** 창이 죽었는지. 테스트가 도중에 바꾼다 — 그래서 `let` 이 아니라 객체다. */
export const windowState = { destroyed: false }

/**
 * `vi.mock('electron', ...)` 의 공장. 호출부는 이렇게 쓴다:
 *
 * ```ts
 * vi.mock('electron', async () => (await import('./gitBridgeTestHarness')).electronMock())
 * ```
 *
 * 동적 import 인 이유는 `vi.mock` 이 import 위로 끌어올려지기 때문이다 — 정적으로 참조하면
 * 공장이 도는 시점에 이 모듈이 아직 없다.
 */
export function electronMock(): Record<string, unknown> {
  return {
    ipcMain: {
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
      removeHandler: (channel: string) => handlers.delete(channel),
    },
    BrowserWindow: class {
      isDestroyed() {
        return windowState.destroyed
      }
      webContents = {
        send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
      }
    },
    app: { getPath: () => tmpdir() },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  }
}

/** 판을 처음 상태로 되돌린다. `beforeEach` 가 부른다. */
export function resetHarness(): void {
  handlers.clear()
  sent.length = 0
  windowState.destroyed = false
}

/** 커밋 하나가 든 진짜 저장소 + 프로젝트 목록을 둘 임시 디렉토리. */
export async function makeRepo(): Promise<{ dir: string; root: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'davis-gitbridge-'))
  const root = await realpath(await mkdtemp(join(tmpdir(), 'davis-gitrepo-')))
  await runGit(['init', '-b', 'main'], root)
  await runGit(['config', 'user.email', 'test@example.com'], root)
  await runGit(['config', 'user.name', '테스트'], root)
  await writeFile(join(root, 'a.txt'), 'one\n')
  await runGit(['add', '-A'], root)
  await runGit(['commit', '-m', '첫 커밋'], root)
  return { dir, root }
}

export async function removeRepo(dir: string, root: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
  await rm(root, { recursive: true, force: true })
}

/** 브리지를 실제로 등록한다. 레지스트리도 진짜다 — rootOf 가 여는 그 목록을 본다. */
export async function setup(
  dir: string,
  root: string,
): Promise<{ projectId: string; close: () => Promise<void> }> {
  const { GitBridge } = await import('./gitBridge')
  const { ProjectRegistry } = await import('../projects/projectRegistry')
  const { ProjectStore } = await import('../projects/projectStore')
  const { BrowserWindow } = await import('electron')

  const registry = new ProjectRegistry({ store: new ProjectStore(join(dir, 'projects.json')) })
  const opened = await registry.open(root)
  if (!opened.ok) throw new Error(opened.message)

  new GitBridge(new BrowserWindow() as never, registry).register()
  return { projectId: opened.project.id, close: () => registry.close(opened.project.id) }
}

export async function call<T>(channel: string, payload: unknown): Promise<T> {
  const handler = handlers.get(channel)
  if (handler === undefined) throw new Error(`${channel} 핸들러가 등록되지 않았습니다`)
  return (await handler({}, payload)) as T
}

export function pushes(): { projectId: string; payload: GitStatePayload }[] {
  return sent
    .filter((entry) => entry.channel === Channel.GIT_STATE_PUSH)
    .map((entry) => entry.payload as { projectId: string; payload: GitStatePayload })
}

export function lastState(): GitState {
  const last = pushes().slice(-1)[0]
  if (last === undefined) throw new Error('밀려온 상태가 없습니다')
  return last.payload.state
}
