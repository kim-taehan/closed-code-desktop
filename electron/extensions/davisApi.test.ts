import { describe, expect, it, vi } from 'vitest'
import {
  createDavisApi,
  METHOD_GET_PROJECT_PATH,
  METHOD_LIST_FILES,
  METHOD_READ_FILE,
  METHOD_SET_ROWS,
  METHOD_UI_ASK_TEXT,
} from './davisApi'

describe('createDavisApi — 부모에게 넘기는 모양', () => {
  it('메서드 이름과 인자를 그대로 싣는다', async () => {
    const call = vi.fn(async (method: string) => {
      if (method === METHOD_LIST_FILES) return ['a.ts']
      if (method === METHOD_SET_ROWS) return undefined
      return '/project'
    })
    const davis = createDavisApi(call, '샘플확장')

    await davis.workspace.getProjectPath()
    await davis.workspace.listFiles('**/*.ts')
    await davis.workspace.readFile('src/a.ts')
    await davis.view.setRows('v1', [{ a: 1 }])

    expect(call.mock.calls).toEqual([
      // 인자 없는 호출은 params 자리를 비운다 — rpc.ts 가 undefined 키를 봉투에 넣지 않는다
      [METHOD_GET_PROJECT_PATH],
      [METHOD_LIST_FILES, { glob: '**/*.ts' }],
      [METHOD_READ_FILE, { path: 'src/a.ts' }],
      [METHOD_SET_ROWS, { viewId: 'v1', rows: [{ a: 1 }] }],
    ])
  })

  it('부모의 거부가 확장에 그대로 던져진다 — 확장이 건너뛸 수 있어야 한다', async () => {
    const davis = createDavisApi(() => Promise.reject(new Error('not_allowed')), '샘플확장')

    await expect(davis.workspace.readFile('../밖.ts')).rejects.toThrow(/not_allowed/)
  })
})

describe('createDavisApi — 응답 모양을 확인한다', () => {
  // `as` 로 단정하면 확장 안 엉뚱한 자리에서 터진다. 여기서 시끄럽게 실패하는 편이 낫다.
  it.each([
    ['getProjectPath', () => createDavisApi(async () => 42, '샘플확장').workspace.getProjectPath()],
    ['readFile', () => createDavisApi(async () => null, '샘플확장').workspace.readFile('a.ts')],
    ['listFiles(배열 아님)', () => createDavisApi(async () => 'a.ts', '샘플확장').workspace.listFiles('*')],
    ['listFiles(원소가 문자열 아님)', () => createDavisApi(async () => [1], '샘플확장').workspace.listFiles('*')],
  ])('%s 가 이상한 값을 받으면 던진다', async (_name, act) => {
    await expect(act()).rejects.toThrow(/응답이/)
  })
})

describe('createDavisApi — 사람에게 묻기', () => {
  // 확장 이름을 확장이 실어 보내면 남의 이름으로 창을 띄울 수 있다 (`storage` 와 같은 규칙)
  it('확장 이름은 대리자가 채우고, 안 준 값은 기본으로 편다', async () => {
    const call = vi.fn(async () => '고친 글')
    const davis = createDavisApi(call, 'test-scenario', '테스트 시나리오')

    const answer = await davis.ui.askText({ title: '본보기' })

    expect(call.mock.calls).toEqual([
      // **사람이 읽는 이름**이 실린다 — 저장소 열쇠(`test-scenario`)가 아니다
      [METHOD_UI_ASK_TEXT, { label: '테스트 시나리오', title: '본보기', value: '', multiline: false }],
    ])
    expect(answer).toBe('고친 글')
  })

  // 표시 이름을 안 주면 id 로 떨어진다 — 창이 이름 없이 뜨는 일은 없다
  it('힌트와 처음 값을 그대로 싣는다', async () => {
    const call = vi.fn(async (_method: string, _params?: unknown) => '')
    const davis = createDavisApi(call, 'ext')

    await davis.ui.askText({ title: '제목', hint: '도움말', value: '이전 것', multiline: true })

    expect(call.mock.calls[0]?.[1]).toEqual({
      label: 'ext',
      title: '제목',
      hint: '도움말',
      value: '이전 것',
      multiline: true,
    })
  })

  // 취소를 빈 문자열로 눙치면 확장이 "사람이 다 지웠다" 로 읽고 저장된 것을 날린다
  it('취소는 null 그대로 온다 — 빈 문자열로 눙치지 않는다', async () => {
    const cancelled = createDavisApi(async () => null, 'ext')
    const empty = createDavisApi(async () => '', 'ext')

    expect(await cancelled.ui.askText({ title: 'x' })).toBeNull()
    expect(await empty.ui.askText({ title: 'x' })).toBe('')
  })

  it('문자열도 null 도 아니면 던진다 — 조용히 넘기면 확장 안에서 터진다', async () => {
    const davis = createDavisApi(async () => 42, 'ext')

    await expect(davis.ui.askText({ title: 'x' })).rejects.toThrow(METHOD_UI_ASK_TEXT)
  })
})
