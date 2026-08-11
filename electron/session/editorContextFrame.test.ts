import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectAndHandshake, type SessionFixture } from '../../tests/fake-runtime/chatSessionKit'
import { normalizeSendContext } from './editorContext'
import type { ChatSendContext } from '../../shared/ipc/chatPayloads'

// activeEditor / dirtyFiles 를 **실제 소켓으로 흘려보내고** 나간 프레임을 검사한다.
//
// 왜 재생이어야 하는가: runtime 은 `populate_by_name=False` + `extra='ignore'` 라
// 키를 틀려도 **에러를 돌려주지 않는다** — 조용히 버린다. 타입 통과는 증거가 되지 않는다.
// 게다가 `serializeEnvelope()` 의 snake_case 허용목록은 **전송 직전에만** 작동하므로
// (envelope.ts:21-36), 실제로 보내 봐야 `start_offset`/`end_offset` 등재 누락이 드러난다.
//
// ProjectSession.send 가 하는 일과 같은 순서로 조립한다:
//   normalizeSendContext(경로 정규화 + `git:` 탭 제외) → chat.send → chatRequestFrame

const ROOT = '/Users/me/proj'

let fixture: SessionFixture | null = null
afterEach(async () => {
  await fixture?.dispose()
  fixture = null
})

async function sendAndCapture(context: ChatSendContext): Promise<Record<string, unknown>> {
  fixture = await connectAndHandshake({})
  fixture.chat.send('이 함수 고쳐줘', normalizeSendContext(context, ROOT))

  await vi.waitFor(() =>
    expect(fixture!.server.received.some((frame) => frame.action === 'chat_request')).toBe(true),
  )
  return fixture.server.received.find((frame) => frame.action === 'chat_request')!.data!
}

describe('chat_request 로 실제로 나가는 편집기 컨텍스트', () => {
  it('selection 이 snake_case 키로 나가고 전송이 막히지 않는다', async () => {
    // 이 테스트가 지키는 것은 두 가지다.
    //  ① 키 이름 — camelCase 로 바꾸면 runtime 이 selection 을 조용히 버린다.
    //  ② envelope.ts 허용목록 등재 — 빠지면 serializeEnvelope 가 던져 **프레임이 아예 안 나간다**.
    //     그래서 "받은 프레임이 있다" 는 것 자체가 등재의 증거다.
    const data = await sendAndCapture({
      activeEditor: { filePath: 'src/a.ts', selection: { startLine: 12, endLine: 20 } },
    })

    const editor = data['activeEditor'] as Record<string, unknown>
    expect(editor['selection']).toEqual({ start_offset: 12, end_offset: 20 })
  })

  it('경로는 절대경로로 나간다 — 상대경로면 runtime 가드가 조용히 안 걸린다', async () => {
    const data = await sendAndCapture({
      activeEditor: { filePath: 'src/a.ts' },
      dirtyFiles: ['src/a.ts', 'docs/b.md'],
    })

    expect((data['activeEditor'] as Record<string, unknown>)['filePath']).toBe('/Users/me/proj/src/a.ts')
    expect(data['dirtyFiles']).toEqual(['/Users/me/proj/src/a.ts', '/Users/me/proj/docs/b.md'])
  })

  it('selection 이 없으면 selection 키 없이 filePath 만 나간다', async () => {
    const data = await sendAndCapture({ activeEditor: { filePath: 'src/a.ts' } })
    expect(data['activeEditor']).toEqual({ filePath: '/Users/me/proj/src/a.ts' })
  })

  it('activeEditor 가 없으면 필드가 아예 안 나간다', async () => {
    const data = await sendAndCapture({})
    expect('activeEditor' in data).toBe(false)
  })

  it('dirtyFiles 는 빈 배열이어도 나간다 (생략 규칙이 반대)', async () => {
    // ⚠️ 회귀 방지: 나머지 필드는 omit-when-empty 인데 dirtyFiles 만 다르다.
    // `[]` = "dirty 파일 없음" 의 명시 신호, 생략 = "IDE 가 알려주지 않음" 으로 뜻이 갈린다
    // (DC-603, vscode MessageFactory.ts:143-145). 근거 없이 보면 "일관성" 을 이유로
    // 생략으로 바꾸기 쉬운 자리라 실제 나간 프레임에서 잠근다.
    const data = await sendAndCapture({ dirtyFiles: [] })
    expect('dirtyFiles' in data).toBe(true)
    expect(data['dirtyFiles']).toEqual([])
  })

  it('`git:` 가짜 탭은 양쪽에서 걸러진 채로 나간다', async () => {
    // git diff 탭은 실제 파일이 아니라 탭 식별자다 (useOpenFiles.ts:53-56).
    // renderer 가 걸러 보내는 것을 믿지 않는다 — main 에서도 막는 것이 이 테스트의 대상이다.
    const data = await sendAndCapture({
      activeEditor: { filePath: 'git:unstaged:src/a.ts' },
      dirtyFiles: ['git:staged:src/a.ts', 'src/b.ts'],
    })

    expect('activeEditor' in data).toBe(false)
    expect(data['dirtyFiles']).toEqual(['/Users/me/proj/src/b.ts'])
  })

  it('기존 필드(query·model)는 새 필드와 무관하게 그대로다', async () => {
    const data = await sendAndCapture({ model: 'gpt-x', dirtyFiles: [] })
    expect(data['query']).toBe('이 함수 고쳐줘')
    expect(data['model']).toBe('gpt-x')
  })
})
