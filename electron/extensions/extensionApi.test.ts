import { describe, expect, it, vi } from 'vitest'
import {
  createExtensionApi,
  METHOD_GET_PROJECT_PATH,
  METHOD_LIST_FILES,
  METHOD_PROGRESS,
  METHOD_READ_FILE,
  METHOD_SET_ROWS,
  METHOD_UI_ASK_TEXT,
} from './extensionApi'

describe('createExtensionApi — 부모에게 넘기는 모양', () => {
  it('메서드 이름과 인자를 그대로 싣는다', async () => {
    const call = vi.fn(async (method: string) => {
      if (method === METHOD_LIST_FILES) return { files: ['a.ts'], truncated: false }
      if (method === METHOD_SET_ROWS) return undefined
      return '/project'
    })
    const code = createExtensionApi(call, '샘플확장')

    await code.workspace.getProjectPath()
    await code.workspace.listFiles('**/*.ts')
    await code.workspace.readFile('src/a.ts')
    await code.view.setRows('v1', [{ a: 1 }])

    expect(call.mock.calls).toEqual([
      // 인자 없는 호출은 params 자리를 비운다 — rpc.ts 가 undefined 키를 봉투에 넣지 않는다
      [METHOD_GET_PROJECT_PATH],
      [METHOD_LIST_FILES, { glob: '**/*.ts' }],
      [METHOD_READ_FILE, { path: 'src/a.ts' }],
      [METHOD_SET_ROWS, { viewId: 'v1', rows: [{ a: 1 }] }],
    ])
  })

  it('부모의 거부가 확장에 그대로 던져진다 — 확장이 건너뛸 수 있어야 한다', async () => {
    const code = createExtensionApi(() => Promise.reject(new Error('not_allowed')), '샘플확장')

    await expect(code.workspace.readFile('../밖.ts')).rejects.toThrow(/not_allowed/)
  })
})

describe('createExtensionApi — 응답 모양을 확인한다', () => {
  // `as` 로 단정하면 확장 안 엉뚱한 자리에서 터진다. 여기서 시끄럽게 실패하는 편이 낫다.
  /**
   * **잘렸으면 그 자리에서 알린다.**
   *
   * 확장에게는 예전과 똑같이 `string[]` 만 주므로 확장 코드는 안 고쳐도 된다.
   * 알리는 자리가 자식 쪽인 이유는 **이름** 때문이다 — 진행 줄에는 낸 확장 이름이 있어야
   * 하는데 호스트는 `listFiles` 를 누가 불렀는지 모른다.
   */
  it('목록이 잘리면 진행 줄로 알린다 — 돌려주는 값은 그대로 배열이다', async () => {
    const sent: { method: string; params: unknown }[] = []
    const code = createExtensionApi(async (method, params) => {
      sent.push({ method, params })
      if (method === METHOD_LIST_FILES) return { files: ['a.ts'], truncated: true }
      return undefined
    }, '샘플확장')

    expect(await code.workspace.listFiles('**/*.ts')).toEqual(['a.ts'])

    const note = sent.find((one) => one.method === METHOD_PROGRESS)
    expect(note, '조용히 넘기면 화면이 절반을 전부라고 말한다').toBeDefined()
    expect((note?.params as Record<string, unknown>)['extension']).toBe('샘플확장')
    expect(String((note?.params as Record<string, unknown>)['text'])).toContain('전부가 아닙니다')
  })

  it('안 잘렸으면 아무 말도 안 한다', async () => {
    const sent: string[] = []
    const code = createExtensionApi(async (method) => {
      sent.push(method)
      if (method === METHOD_LIST_FILES) return { files: ['a.ts'], truncated: false }
      return undefined
    }, '샘플확장')

    await code.workspace.listFiles('**/*.ts')

    expect(sent).not.toContain(METHOD_PROGRESS)
  })

  it.each([
    ['getProjectPath', () => createExtensionApi(async () => 42, '샘플확장').workspace.getProjectPath()],
    ['readFile', () => createExtensionApi(async () => null, '샘플확장').workspace.readFile('a.ts')],
    ['listFiles(배열 아님)', () => createExtensionApi(async () => ({ files: 'a.ts' }), '샘플확장').workspace.listFiles('*')],
    ['listFiles(원소가 문자열 아님)', () => createExtensionApi(async () => ({ files: [1] }), '샘플확장').workspace.listFiles('*')],
  ])('%s 가 이상한 값을 받으면 던진다', async (_name, act) => {
    await expect(act()).rejects.toThrow(/응답이/)
  })
})

describe('createExtensionApi — 사람에게 묻기', () => {
  // 확장 이름을 확장이 실어 보내면 남의 이름으로 창을 띄울 수 있다 (`storage` 와 같은 규칙)
  it('확장 이름은 대리자가 채우고, 안 준 값은 기본으로 편다', async () => {
    const call = vi.fn(async () => '고친 글')
    const code = createExtensionApi(call, 'test-scenario', '테스트 시나리오')

    const answer = await code.ui.askText({ title: '본보기' })

    expect(call.mock.calls).toEqual([
      // **사람이 읽는 이름**이 실린다 — 저장소 열쇠(`test-scenario`)가 아니다
      [METHOD_UI_ASK_TEXT, { label: '테스트 시나리오', title: '본보기', value: '', multiline: false }],
    ])
    expect(answer).toBe('고친 글')
  })

  // 표시 이름을 안 주면 id 로 떨어진다 — 창이 이름 없이 뜨는 일은 없다
  it('힌트와 처음 값을 그대로 싣는다', async () => {
    const call = vi.fn(async (_method: string, _params?: unknown) => '')
    const code = createExtensionApi(call, 'ext')

    await code.ui.askText({ title: '제목', hint: '도움말', value: '이전 것', multiline: true })

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
    const cancelled = createExtensionApi(async () => null, 'ext')
    const empty = createExtensionApi(async () => '', 'ext')

    expect(await cancelled.ui.askText({ title: 'x' })).toBeNull()
    expect(await empty.ui.askText({ title: 'x' })).toBe('')
  })

  it('문자열도 null 도 아니면 던진다 — 조용히 넘기면 확장 안에서 터진다', async () => {
    const code = createExtensionApi(async () => 42, 'ext')

    await expect(code.ui.askText({ title: 'x' })).rejects.toThrow(METHOD_UI_ASK_TEXT)
  })
})
