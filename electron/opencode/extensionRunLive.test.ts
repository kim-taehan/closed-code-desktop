import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Handshake } from '../session/handshake'
import { parseInbound } from '../../shared/protocol/envelope'
import { OpencodeConnection } from './connection'
import { ExtensionAiRuns } from './extensionRun'
import { SseStream } from './sse'
import type { OpencodeEvent } from './events'

// **실서버로 재는 확장 AI 세션** (확장 재설계 §6 4단계 확인 — 「실측 서버로」). 기본은 건너뛴다:
//
//   cd <빈 폴더> && ~/.bun/bin/opencode serve --port 4917 --hostname 127.0.0.1
//   OPENCODE_LIVE=1 OPENCODE_URL=http://127.0.0.1:4917 OPENCODE_LIVE_DIR=<그 빈 폴더> \
//     OPENCODE_LIVE_MODEL=davis-litellm/qwen3.8-27b npx vitest run electron/opencode/extensionRunLive.test.ts
//
// ⚠️ **작업 폴더는 서버의 cwd 여야 한다** — 앱이 그렇게 띄운다(`serverPool.ts`: 프로젝트 루트가 cwd).
// 사용자 채팅은 `/event` 를 `?directory=` 없이 여는데, 그 스트림은 **서버 cwd 인스턴스의 세션만** 싣는다
// (2026-09-22 실측). 다른 폴더를 주면 사용자 턴의 이벤트가 안 와서 이 시험이 시간 초과로 멈춘다.
//
// 한 서버에 사용자 턴과 확장 턴을 **동시에** 돌리고, 서로의 글이 서로에게 0건인지 본다. 둘 다 저마다
// 다른 낱말을 그대로 따라 말하게 해서, 그 낱말이 어느 쪽에 섰는지로 샘을 가른다.
// `OPENCODE_LIVE_MODEL` 은 작업 폴더의 `opencode.json` 에 적는다 — 전역 설정을 건드리지 않는다.

const LIVE = process.env['OPENCODE_LIVE'] === '1'
const BASE = process.env['OPENCODE_URL'] ?? 'http://127.0.0.1:4096'
const MODEL = process.env['OPENCODE_LIVE_MODEL']
const DIR = process.env['OPENCODE_LIVE_DIR']

describe.skipIf(!LIVE)('live 확장 AI 세션', () => {
  it('사용자 턴과 동시에 돌려도 서로의 글이 0건이고, 읽기 전용이라 승인 요청이 없다', async () => {
    // **레포 루트를 주지 말 것** (live.test.ts 와 같은 사유 — 초기 스캔에서 멈춘다)
    const workspacePath = DIR ?? mkdtempSync(join(tmpdir(), 'oc-ext-live-'))
    writeFileSync(join(workspacePath, 'sample.txt'), '확장이 읽을 파일\n')
    writeFileSync(join(workspacePath, '.env'), 'SECRET=do-not-read\n')
    if (MODEL) writeFileSync(join(workspacePath, 'opencode.json'), JSON.stringify({ model: MODEL }))

    // 전역 스트림을 그대로 떠 둔다 — 확장 세션 이벤트가 실제로 선 위에 흘렀는지, 승인 요청이 왔는지
    const wire: OpencodeEvent[] = []
    const tap = new SseStream({ url: `${BASE}/event`, autoReconnect: false })
    tap.onEvent((event) => wire.push(event))
    tap.start()

    // 사용자 채팅 — 앱이 쓰는 그대로의 연결
    const user = new OpencodeConnection({ baseUrl: BASE, autoReconnect: false })
    // 사용자 채팅이 받은 것 — 글 조각은 **이어 붙여** 본다 (낱말이 조각 사이에서 갈려 원문 검색으로는 안 잡힌다)
    // 그리고 프레임 원문 전부 — 도구 카드 등 글 아닌 자리에 선 것까지
    let userText = ''
    let userFrames = ''
    let userEnded = false
    user.onMessage((raw) => {
      const frame = parseInbound(raw)
      if (frame?.action === 'stream_end') userEnded = true
      const data = frame?.data as Record<string, unknown> | undefined
      if (frame?.action === 'stream_chunk' && typeof data?.['message'] === 'string') userText += data['message']
      userFrames += `\n${raw}`
    })
    const ready = new Handshake(user, { workspacePath, projectName: 'oc-ext-live' }).run()
    await user.connect()
    await ready

    const ledger = new Map<string, string>()
    const runs = new ExtensionAiRuns({
      sessions: {
        get: (extension, project) => ledger.get(`${extension}|${project}`),
        set: (extension, project, id) => void ledger.set(`${extension}|${project}`, id),
      },
      server: async () => ({ url: BASE, directory: workspacePath }),
    })

    user.send(JSON.stringify({ reqId: 'u1', kind: 'chat', action: 'chat_request', data: { query: '다음 낱말만 그대로 답해: GIRAFFE1770' } }))
    const pieces: string[] = []
    const answer = await runs.run(
      {
        extension: 'live-ext',
        projectId: 'p-live',
        runId: 'run-live',
        prompt: 'sample.txt 와 .env 를 읽어 보고, 마지막 줄에 다음 낱말만 그대로 적어라: ZEBRA4417',
      },
      (text) => pieces.push(text),
    )
    for (let waited = 0; !userEnded && waited < 120; waited += 1) await new Promise((r) => setTimeout(r, 500))
    tap.close()
    user.close()

    const extSession = ledger.get('live-ext|p-live') ?? ''
    const onWire = wire.filter((event) => (event.properties as Record<string, unknown>)['sessionID'] === extSession)
    console.log(`[live] 확장 세션 ${extSession} — 선 위 이벤트 ${onWire.length}건, 답: ${answer.text}`)

    expect(onWire.length, '확장 세션 이벤트가 서버 전역 스트림에 실제로 흘렀다 (그래야 0건이 뜻을 가진다)').toBeGreaterThan(5)
    expect(answer.text).toContain('ZEBRA4417')
    expect(pieces.join('')).toBe(answer.text)
    expect(answer.text, '사용자 턴의 글이 ai.run 에 섰다').not.toContain('GIRAFFE1770')
    expect(userEnded).toBe(true)
    expect(userText, '사용자 턴의 답이 사용자 채팅에 왔다').toContain('GIRAFFE1770')
    expect(userText, '확장 세션의 글이 사용자 채팅에 섰다').not.toContain('ZEBRA4417')
    expect(userFrames, '확장 세션의 도구 카드(sample.txt 읽기)가 사용자 채팅에 섰다').not.toContain('sample.txt')
    expect(answer.text, '.env 내용이 읽혔다').not.toContain('do-not-read')
    expect(wire.filter((event) => event.type === 'permission.asked' || event.type === 'question.asked')).toEqual([])
  }, 240_000)
})
