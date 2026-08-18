// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useFileTreeActions } from './useFileTreeActions'

// 우클릭 메뉴의 배선. **어디에 만드나**와 **실패를 사람 말로 옮기나**가 표적이다.
//
// 파일시스템 자체는 main 이 지고 그쪽 시험이 따로 있다 (`projectFs.action.test.ts`).
// 층이 잠겼는지와 층 사이가 이어졌는지는 다른 질문이라, 여기서는 **나가는 payload** 를 본다.

const fsAction = vi.fn()
const refresh = vi.fn()
const notify = vi.fn()

beforeEach(() => {
  fsAction.mockReset()
  refresh.mockReset()
  notify.mockReset()
  fsAction.mockResolvedValue({ ok: true })
  ;(window as unknown as { davis: unknown }).davis = { fsAction }
})

function open(path: string, isDirectory: boolean) {
  const hook = renderHook(() => useFileTreeActions('p1', refresh, notify))
  act(() => hook.result.current.openMenu(path, isDirectory, 10, 20))
  return hook
}

/** 메뉴에서 고르고, 창이 뜨면 이름까지 답한다 */
async function pick(hook: ReturnType<typeof open>, choice: 'newFile' | 'newDir' | 'rename' | 'trash', name?: string) {
  await act(async () => hook.result.current.pick(choice))
  if (name !== undefined) await act(async () => hook.result.current.submit(name))
}

describe('어디에 만드나', () => {
  // 폴더 위에서는 그 **안**에, 파일 위에서는 그 파일이 **든 폴더**에 만든다.
  it('폴더를 우클릭하면 그 안에 만든다', async () => {
    const hook = open('src/lib', true)
    await pick(hook, 'newFile', 'a.ts')

    expect(fsAction).toHaveBeenCalledWith({
      projectId: 'p1',
      action: { kind: 'newFile', path: 'src/lib/a.ts' },
    })
  })

  it('파일을 우클릭하면 그 옆에 만든다', async () => {
    const hook = open('src/lib/index.ts', false)
    await pick(hook, 'newDir', '새폴더')

    expect(fsAction).toHaveBeenCalledWith({
      projectId: 'p1',
      action: { kind: 'newDir', path: 'src/lib/새폴더' },
    })
  })

  it('루트 바로 밑도 된다 — 앞에 슬래시를 붙이지 않는다', async () => {
    const hook = open('README.md', false)
    await pick(hook, 'newFile', 'a.ts')

    expect(fsAction).toHaveBeenCalledWith({ projectId: 'p1', action: { kind: 'newFile', path: 'a.ts' } })
  })

  // 이름만 바뀌지 폴더를 넘어가지 않는다 — 창에는 이름만 채워져 있다
  it('이름 변경은 같은 폴더 안에서 간다', async () => {
    const hook = open('src/lib/index.ts', false)
    await pick(hook, 'rename', 'main.ts')

    expect(fsAction).toHaveBeenCalledWith({
      projectId: 'p1',
      action: { kind: 'rename', path: 'src/lib/index.ts', to: 'src/lib/main.ts' },
    })
  })
})

describe('묻는 것과 안 묻는 것', () => {
  it('휴지통은 바로 보낸다 — 되돌릴 수 있으므로 확인을 두지 않는다', async () => {
    const hook = open('src/a.ts', false)
    await pick(hook, 'trash')

    expect(hook.result.current.prompt).toBeNull()
    expect(fsAction).toHaveBeenCalledWith({ projectId: 'p1', action: { kind: 'trash', path: 'src/a.ts' } })
  })

  it('이름 변경 창에는 지금 이름이 채워져 있다 — 고쳐 쓰는 것이 기본이다', async () => {
    const hook = open('src/lib/index.ts', false)
    await act(async () => hook.result.current.pick('rename'))

    expect(hook.result.current.prompt?.value).toBe('index.ts')
  })

  // **취소는 실패가 아니다** — 아무 일도 안 일어난다
  it('취소하면 아무것도 안 부른다', async () => {
    const hook = open('src/a.ts', false)
    await act(async () => hook.result.current.pick('newFile'))
    await act(async () => hook.result.current.submit(null))

    expect(fsAction).not.toHaveBeenCalled()
    expect(hook.result.current.prompt).toBeNull()
  })

  it('빈 이름도 아무것도 안 부른다', async () => {
    const hook = open('src/a.ts', false)
    await pick(hook, 'newFile', '   ')

    expect(fsAction).not.toHaveBeenCalled()
  })
})

describe('끝난 뒤', () => {
  it('된 자리만 다시 읽는다', async () => {
    const hook = open('src/lib', true)
    await pick(hook, 'newFile', 'a.ts')

    expect(refresh).toHaveBeenCalledWith('src/lib')
  })

  // 실패했는데 다시 읽으면 같은 목록이 그려져 사용자는 「무언가 일어났다」로 읽는다
  it('실패하면 다시 읽지 않고 사람 말로 알린다', async () => {
    fsAction.mockResolvedValue({ ok: false, reason: 'exists' })
    const hook = open('src/lib', true)
    await pick(hook, 'newFile', 'a.ts')

    expect(refresh).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith('같은 이름이 이미 있습니다')
  })

  // 부르는 쪽이 `void` 라 던지는 것을 여기서 안 받으면 아무 말 없이 사라진다
  it('던져도 조용히 죽지 않는다', async () => {
    fsAction.mockRejectedValue(new Error('no handler'))
    const hook = open('src/lib', true)
    await pick(hook, 'newFile', 'a.ts')

    expect(notify).toHaveBeenCalledWith('하지 못했습니다')
    expect(refresh).not.toHaveBeenCalled()
  })
})
