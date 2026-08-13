import { describe, expect, it } from 'vitest'
import { createExtensionApi, METHOD_PROGRESS } from './extensionApi'
import { dispatchExtensionApi, REFUSE_STORAGE, refuseAsk, refuseAskText, refuseExport } from './serviceDispatch'
import { ExtensionWorkspace } from './workspaceApi'
import type { ExtensionProgressPayload } from '../../shared/ipc/extensionPayloads'

// `code.progress` 의 **주인 표시** 계약.
//
// 잡는 회귀: 진행 문구에 낸 확장 이름이 없으면, 지금 보고 있는 확장의 바에 **남의 문구**가
// 찍힌다. `redraw` 가 켜진 확장 전부를 돌리므로(`extensionLoader.ts` 의 `redraws`) 흔한
// 상황이다 — 실측: 테스트 시나리오 트리를 보는 중에 현행분석의
// 「analyzer(http://localhost:8080) 에서 실행을 찾는 중…」이 그 자리에 떴다.
//
// 행·화면·트리는 `viewId` 로 갈리는데 진행만 안 갈렸다. 진행은 뷰를 모르므로(`code.progress`
// 가 뷰를 받지 않는다) **확장 이름**으로 가른다.

/** 진행만 보는 최소 배선. 다른 포트는 불리면 안 되므로 거절 함수 그대로 둔다. */
function bedFor(projectId: string | null) {
  const seen: ExtensionProgressPayload[] = []
  const deps = {
    // 진행은 파일을 안 만진다 — 열린 프로젝트가 없는 진짜 것을 준다.
    // 혹시 불리면 던지므로, 조용히 통과하는 대신 시험이 터져서 알려 준다.
    workspace: new ExtensionWorkspace(() => null),
    exportFile: refuseExport,
    ask: refuseAsk,
    askText: refuseAskText,
    storage: REFUSE_STORAGE,
    activeFile: () => null,
    projectId: () => projectId,
    emitRows: () => {},
    emitHtml: () => {},
    emitTree: () => {},
    emitProgress: (payload: ExtensionProgressPayload) => {
      seen.push(payload)
    },
    // 진행 알림은 통지를 쓰지 않는다 — 불리면 시험이 알아채도록 던진다
    notifyChild: () => {
      throw new Error('진행 알림이 자식 통지를 부를 이유가 없다')
    },
  }
  return { seen, deps }
}

describe('code.progress 의 주인 표시', () => {
  it('확장 이름을 확장이 아니라 API 층이 채운다 — 남의 이름을 실을 수 없다', async () => {
    const sent: unknown[] = []
    const api = createExtensionApi(
      (method, params) => {
        sent.push({ method, params })
        return Promise.resolve(undefined)
      },
      'test-scenario',
      '테스트 시나리오',
    )

    // 확장이 남의 이름을 실으려 해도 인자에 그런 자리가 없다 — 이것이 계약이다
    api.progress('훑는 중…', 3, 10)
    await Promise.resolve()

    expect(sent).toEqual([
      { method: METHOD_PROGRESS, params: { extension: 'test-scenario', text: '훑는 중…', done: 3, total: 10 } },
    ])
  })

  it('두 확장이 함께 알려도 각자의 이름이 붙어 나간다', async () => {
    const { seen, deps } = bedFor('p1')

    await dispatchExtensionApi(deps, {
      kind: 'request' as const,
      id: '1',
      method: METHOD_PROGRESS,
      params: { extension: 'current-analysis', text: 'analyzer 에서 실행을 찾는 중…' },
    })
    await dispatchExtensionApi(deps, {
      kind: 'request' as const,
      id: '2',
      method: METHOD_PROGRESS,
      params: { extension: 'test-scenario', text: '작성 중…', done: 2, total: 7 },
    })

    expect(seen).toEqual([
      { extension: 'current-analysis', text: 'analyzer 에서 실행을 찾는 중…', done: undefined, total: undefined },
      { extension: 'test-scenario', text: '작성 중…', done: 2, total: 7 },
    ])
  })

  it('이름이 없으면 던진다 — 주인 없는 줄은 어느 바에도 못 뜬다', async () => {
    const { seen, deps } = bedFor('p1')

    await expect(
      dispatchExtensionApi(deps, { kind: 'request' as const, id: '3', method: METHOD_PROGRESS, params: { text: '도는 중…' } }),
    ).rejects.toThrow('extension')
    expect(seen).toEqual([])
  })

  it('끝났다는 알림(text: null)에도 이름이 실린다 — 지울 칸을 골라야 한다', async () => {
    const { seen, deps } = bedFor('p1')

    await dispatchExtensionApi(deps, {
      kind: 'request' as const,
      id: '4',
      method: METHOD_PROGRESS,
      params: { extension: 'current-analysis', text: null },
    })

    expect(seen).toEqual([{ extension: 'current-analysis', text: null, done: undefined, total: undefined }])
  })
})

// 쌓을 줄·레인은 **알림의 곁다리**다. 못 알아들으면 그 칸만 빼고 나머지는 그대로 간다 —
// 확장이 오타를 냈다고 진행 알림 자체가 실패하면, 도는 동안 화면이 통째로 조용해진다.
describe('쌓을 줄과 겹쳐 도는 갈래', () => {
  /** 한 번 보내고 그 payload 하나를 돌려준다 */
  async function send(params: Record<string, unknown>) {
    const { seen, deps } = bedFor('p1')
    await dispatchExtensionApi(deps, { kind: 'request' as const, id: '9', method: METHOD_PROGRESS, params })
    return seen[0]!
  }

  it('아는 성격은 그대로 싣는다 — 이 칸이 쌓을지 갈아치울지를 가른다', async () => {
    expect((await send({ extension: 'test-scenario', text: '로그인 — 6건', kind: 'done' })).kind).toBe('done')
  })

  it('모르는 성격은 빼고 나머지는 보낸다 — 알림이 통째로 죽지 않는다', async () => {
    const payload = await send({ extension: 'test-scenario', text: '도는 중', kind: '완료' })

    expect(payload.kind).toBeUndefined()
    expect(payload.text).toBe('도는 중')
  })

  it('갈래를 그대로 싣는다 — 「지금 넷이 무엇을 물고 있나」는 확장만 안다', async () => {
    const lanes = [
      { name: '비상 로그인', startedAt: 1000, doing: '읽는 중' },
      { name: '로그인 API', startedAt: 2000 },
    ]

    expect((await send({ extension: 'test-scenario', text: '작성 중', lanes })).lanes).toEqual(lanes)
  })

  it('시각이 없는 갈래는 버린다 — 지금 시각으로 눙치면 화면이 거짓말을 한다', async () => {
    const payload = await send({
      extension: 'test-scenario',
      text: '작성 중',
      lanes: [{ name: '시각 없음' }, { name: '멀쩡한 것', startedAt: 5 }],
    })

    expect(payload.lanes).toEqual([{ name: '멀쩡한 것', startedAt: 5 }])
  })

  it('갈래가 배열이 아니면 그 칸만 뺀다', async () => {
    const payload = await send({ extension: 'test-scenario', text: '작성 중', lanes: '넷' })

    expect(payload.lanes).toBeUndefined()
    expect(payload.text).toBe('작성 중')
  })
})
