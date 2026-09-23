import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExtensionService } from './service'
import { ExtensionWorkspace } from './workspaceApi'
import { LiveChild } from '../../tests/extensions/liveChild'
import type { AiRunRequest, ExtensionAiPort } from './aiDispatch'

// **시험 인프라를 겨눈다** — `LiveChild`(진짜 자식 흉내)가 `hostEntry.ts` 와 같은 배선을 갖는가.
//
// `code.ai.run` 의 글 조각은 응답이 아니라 통지(`NOTICE_AI_TEXT`)로 내려와 자식의 `AiStreams` 가
// 받는다. 그 표를 안 걸면 **`onText` 를 준 확장은 부르기도 전에 던진다** (`aiRunClient.ts`) —
// 층별 시험(`aiRun.test.ts`)은 표를 손으로 만들어 넘기므로 전부 초록인데, 진짜 호스트에 실은
// 확장만 못 돈다. 그래서 확장마다 제 시험에 우회 배선을 깔고 있었다.
//
// 여기서 재는 것은 **한 줄**이다: 부모가 낸 조각이 확장의 `onText` 까지 오는가.
// `ai.run` 의 행선지 규칙·끊기는 `aiRun.test.ts`, 세션 쪽은 `extensionRun.test.ts` 가 본다.

const FIXTURE = join(__dirname, '../../tests/extensions/ai-stream')

let extensionsDir = ''

beforeEach(async () => {
  extensionsDir = await mkdtemp(join(tmpdir(), 'ai-stream-'))
  await cp(FIXTURE, join(extensionsDir, 'ai-stream'), { recursive: true })
})

afterEach(async () => {
  await rm(extensionsDir, { recursive: true, force: true })
})

/** 조각을 흘린 뒤 이어 붙인 답을 주는 AI 포트 (진짜 세션 자리는 `extensionRun.ts`) */
function aiPort(pieces: string[]) {
  const asked: AiRunRequest[] = []
  const port: ExtensionAiPort = {
    run: async (request, onText) => {
      asked.push(request)
      for (const piece of pieces) onText(piece)
      return { text: pieces.join('') }
    },
    cancel: () => {},
  }
  return { port, asked }
}

function bed(pieces: string[]) {
  const ai = aiPort(pieces)
  const rows: { viewId: string; rows: unknown[] }[] = []
  const service = new ExtensionService({
    entryPath: 'ignored',
    fork: () => new LiveChild(),
    extensionsDir,
    workspace: new ExtensionWorkspace(() => null),
    ai: ai.port,
  })
  service.onViewRows((viewId, value) => rows.push({ viewId, rows: value }))
  service.start()
  return { service, rows, asked: ai.asked }
}

describe('LiveChild 가 code.ai.run 의 글 조각을 나른다', () => {
  it('확장이 준 onText 로 조각이 순서대로 오고, 최종 답도 같은 호출에서 돌아온다', async () => {
    const { service, rows, asked } = bed(['가', '나', '다'])

    await service.runCommand('aiStreamFixture.ask', 'P')

    expect(rows).toEqual([{ viewId: 'ai', rows: [{ pieces: '가|나|다', final: '가나다' }] }])
    // 확장 이름·프로젝트는 호스트가 채운 값이다 — 확장은 이름을 말하지 않는다
    expect(asked.map((request) => [request.extension, request.projectId])).toEqual([['ai-stream-fixture', 'P']])
    service.dispose()
  })

  it('조각이 하나도 없어도 답은 온다 — 스트림 없는 실행이 이 배선 때문에 막히지 않는다', async () => {
    const { service, rows } = bed([])

    await service.runCommand('aiStreamFixture.ask', 'P')

    expect(rows).toEqual([{ viewId: 'ai', rows: [{ pieces: '', final: '' }] }])
    service.dispose()
  })
})
