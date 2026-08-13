import { beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Channel } from '../../shared/ipc/channels'
import { SettingsStore } from '../settings/settingsStore'
import { ExtensionBridge } from './extensionBridge'

// wiring.test.ts 는 ipcMain 핸들러의 등록/해제만 본다.
// **onViewRows 구독 누수와 겉봉 규칙은 거기서 안 보인다** — 그래서 여기서 잡는다.

const handlers = new Map<string, (event: unknown, payload?: unknown) => unknown>()
const removed: string[] = []

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, payload?: unknown) => unknown) => {
      handlers.set(channel, handler)
    },
    removeHandler: (channel: string) => removed.push(channel),
    // 활성 파일은 handle 이 아니라 on 으로 붙는다. 그 채널은
    // `extensionBridge.activeFile.test.ts` 가 보고, 여기서는 register() 만 통과시킨다.
    on: () => {},
    removeListener: () => {},
  },
}))

interface Sent {
  channel: string
  payload: unknown
}

function makeBridge(options: { projectId?: string | null; destroyed?: boolean } = {}) {
  const sent: Sent[] = []
  const ran: [string, string | null][] = []
  const redrawn: (string | null)[] = []
  let emit: ((viewId: string, rows: unknown[], projectId: string | null) => void) | null = null
  let subscribed = 0
  let active = options.projectId === undefined ? '프로젝트-1' : options.projectId

  // 서비스가 돌려주는 모양(매니페스트 통째)이다. 브리지가 화면용으로 추려 내보낸다
  const listing = {
    extensions: [
      {
        dir: '/확장/할일',
        manifest: { name: 'todo', displayName: '할 일 모음', version: '0.1.0', main: 'main.js' },
        enabled: true,
      },
    ],
    skipped: [{ dir: '/확장/깨진것', reason: 'missing_main' }],
  }

  const bridge = new ExtensionBridge({
    window: {
      isDestroyed: () => options.destroyed ?? false,
      webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) },
    } as never,
    service: {
      listExtensions: () => Promise.resolve(listing),
      runCommand: (commandId: string, projectId: string | null) => {
        ran.push([commandId, projectId])
        return commandId === '있음' ? Promise.resolve() : Promise.reject(new Error('등록되지 않은 명령입니다'))
      },
      onViewHtml: () => () => {},
      onViewTree: () => () => {},
      onProgress: () => () => {},
      onViewRows: (handler) => {
        emit = handler
        subscribed += 1
        return () => {
          emit = null
        }
      },
      redraw: (projectId: string | null) => {
        redrawn.push(projectId)
        return Promise.resolve()
      },
      activeFileChanged: async () => {},
      // 설치 뒤 재훑기. 이 시험은 설치에 닿지 않지만 생성에는 필요하다
      // (거는지 여부는 `extensionBridge.install.test.ts` 가 본다)
      reload: () => Promise.resolve(),
      restart: () => Promise.resolve(),
    },
    views: { register: () => 'code-ext://view/1' },
    activeProjectId: () => active,
    // 배포처 핸들러도 같은 브리지에 산다. 이 시험은 거기 닿지 않지만 생성에는 필요하다
    settings: new SettingsStore(join(tmpdir(), `code-extbridge-${process.pid}.json`)),
  })

  return {
    bridge,
    sent,
    listing,
    ran,
    /** 세 번째 인자 = 그 행을 낸 명령의 프로젝트. 생략하면 "명령 밖에서 온 행". */
    emitRows: (viewId: string, rows: unknown[], commandProjectId: string | null = null) =>
      emit?.(viewId, rows, commandProjectId),
    /** 사용자가 탭을 옮긴 것 */
    switchProject: (next: string | null) => {
      active = next
    },
    redrawn,
    isSubscribed: () => emit !== null,
    subscribeCount: () => subscribed,
  }
}

describe('확장 브리지', () => {
  beforeEach(() => {
    handlers.clear()
    removed.length = 0
  })

  // 매니페스트를 통째로 넘기지 않는다 — 화면이 쓰는 것만 추려 보낸다
  it('목록을 화면이 쓰는 모양으로 추려 돌려준다 — 건너뛴 것도 함께', async () => {
    const { bridge } = makeBridge()
    bridge.register()

    await expect(handlers.get(Channel.EXTENSION_LIST)?.({})).resolves.toEqual({
      extensions: [
        { dir: '/확장/할일', name: 'todo', displayName: '할 일 모음', version: '0.1.0', enabled: true },
      ],
      skipped: [{ dir: '/확장/깨진것', reason: 'missing_main' }],
    })
  })

  it('명령 실패를 결과 객체로 감싸지 않고 그대로 거부한다', async () => {
    const { bridge } = makeBridge()
    bridge.register()

    await expect(handlers.get(Channel.EXTENSION_RUN_COMMAND)?.({}, { commandId: '있음' })).resolves.toBeUndefined()
    await expect(
      handlers.get(Channel.EXTENSION_RUN_COMMAND)?.({}, { commandId: '없음' }),
    ).rejects.toThrow('등록되지 않은 명령입니다')
  })

  it('명령을 걸 때 그 순간의 활성 프로젝트를 함께 넘긴다 — 겉봉은 여기서 굳는다', async () => {
    const { bridge, ran, switchProject } = makeBridge()
    bridge.register()

    await handlers.get(Channel.EXTENSION_RUN_COMMAND)?.({}, { commandId: '있음' })
    switchProject('프로젝트-2')
    await handlers.get(Channel.EXTENSION_RUN_COMMAND)?.({}, { commandId: '있음' })

    expect(ran).toEqual([
      ['있음', '프로젝트-1'],
      ['있음', '프로젝트-2'],
    ])
  })

  it('명령을 건 프로젝트로 겉봉을 민다 — 도중에 탭을 옮겨도 바뀌지 않는다', () => {
    // 회귀 잠금: 겉봉을 push 시점에 다시 조회하던 때는 '프로젝트-2' 로 나가
    // 결과가 엉뚱한 탭에 그려졌다 (`_workspace/53` M2).
    const { bridge, sent, emitRows, switchProject } = makeBridge()
    bridge.register()

    switchProject('프로젝트-2')
    emitRows('sampleExt.results', [{ file: 'a.ts' }], '프로젝트-1')

    expect(sent[0]?.payload).toMatchObject({ projectId: '프로젝트-1' })
  })

  it('명령을 건 프로젝트가 닫혀 활성이 없어도 그 겉봉으로 민다', () => {
    const { bridge, sent, emitRows, switchProject } = makeBridge()
    bridge.register()

    switchProject(null)
    emitRows('v', [{ file: 'a.ts' }], '프로젝트-1')

    expect(sent[0]?.payload).toMatchObject({ projectId: '프로젝트-1' })
  })

  it('명령 밖에서 온 행은 활성 프로젝트 겉봉을 씌워 민다', () => {
    const { bridge, sent, emitRows } = makeBridge()
    bridge.register()

    emitRows('codeAnalysis.results', [{ file: 'a.ts', line: 1 }])

    expect(sent).toEqual([
      {
        channel: Channel.EXTENSION_ROWS,
        payload: {
          projectId: '프로젝트-1',
          payload: { viewId: 'codeAnalysis.results', rows: [{ file: 'a.ts', line: 1 }] },
        },
      },
    ])
  })

  it('표에 그릴 수 없는 행은 걸러낸다', () => {
    const { bridge, sent, emitRows } = makeBridge()
    bridge.register()

    emitRows('v', ['문자열', 42, null, ['배열'], { file: 'a.ts' }])

    expect(sent[0]?.payload).toMatchObject({ payload: { rows: [{ file: 'a.ts' }] } })
  })

  it('명령 프로젝트도 활성도 없으면 밀지 않는다 — 겉봉을 만들 수 없다', () => {
    const { bridge, sent, emitRows } = makeBridge({ projectId: null })
    bridge.register()

    emitRows('v', [{ file: 'a.ts' }])

    expect(sent).toEqual([])
  })

  it('창이 사라졌으면 밀지 않는다', () => {
    const { bridge, sent, emitRows } = makeBridge({ destroyed: true })
    bridge.register()

    emitRows('v', [{ file: 'a.ts' }])

    expect(sent).toEqual([])
  })

  it('다시 그리기 요청에 지금 활성 프로젝트를 실어 넘긴다', async () => {
    // 회귀 잠금: 확장은 활성화 시점 한 번만 그린다. 화면이 붙은 뒤 이 요청이 안 가면
    // **앱을 껐다 켤 때·탭을 옮길 때 저장된 목록이 통째로 사라져 보인다**
    // (실측: 903개가 저장돼 있는데 「아직 실행하지 않았습니다」가 떴다).
    const { bridge, redrawn, switchProject } = makeBridge()
    bridge.register()

    await handlers.get(Channel.EXTENSION_REDRAW)?.({})
    switchProject('프로젝트-2')
    await handlers.get(Channel.EXTENSION_REDRAW)?.({})

    expect(redrawn).toEqual(['프로젝트-1', '프로젝트-2'])
  })

  it('dispose 가 채널과 함께 행 구독도 푼다 — 창을 다시 만들 때 새지 않게', () => {
    const { bridge, isSubscribed } = makeBridge()
    bridge.register()
    expect(isSubscribed()).toBe(true)

    bridge.dispose()

    expect(isSubscribed()).toBe(false)
    // 이 브리지가 잡은 채널 전부가 풀려야 한다 — 하나라도 남으면 창을 다시 만들 때 던진다
    expect(removed).toEqual([
      Channel.EXTENSION_LIST,
      Channel.EXTENSION_RUN_COMMAND,
      Channel.EXTENSION_REDRAW,
      Channel.EXTENSION_CANCEL,
      Channel.EXTENSION_README,
      Channel.EXTENSION_SET_ENABLED,
      Channel.EXTENSION_UNINSTALL,
      Channel.EXTENSION_EXPORT_CSV,
      Channel.EXTENSION_VIEW_REGISTER,
      Channel.EXTENSION_INSTALL_FROM_DISK,
      Channel.EXTENSION_REGISTRY_LIST,
      Channel.EXTENSION_REGISTRY_ADD,
      Channel.EXTENSION_REGISTRY_REMOVE,
      Channel.EXTENSION_REGISTRY_FETCH,
      Channel.EXTENSION_REGISTRY_README,
      Channel.EXTENSION_REGISTRY_INSTALL,
      // 확장이 사람에게 묻는 통로. 창에 매여 있어 브리지가 쥐고 브리지가 푼다
      Channel.EXTENSION_ASK_TEXT_RESPOND,
    ])
  })

  it('dispose 뒤 다시 register 해도 구독이 겹치지 않는다', () => {
    const { bridge, sent, emitRows, subscribeCount } = makeBridge()
    bridge.register()
    bridge.dispose()
    bridge.register()

    emitRows('v', [{ file: 'a.ts' }])

    expect(subscribeCount()).toBe(2)
    // 구독이 겹쳤다면 같은 행이 두 번 밀린다
    expect(sent).toHaveLength(1)
  })
})
