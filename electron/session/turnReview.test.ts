import { afterEach, describe, expect, it, vi } from 'vitest'
import { TurnReviewStatus, type TurnReview } from '../../shared/protocol/turnReview'
import { FakeRuntimeServer } from '../../tests/fake-runtime/FakeRuntimeServer'
import { turnChangesFrame } from '../../tests/fake-runtime/fakeTurnReview'
import { WsConnection } from '../ws/connection'
import { Handshake } from './handshake'
import { TurnReviewController } from './turnReview'

// 턴 리뷰 (V2). 런타임이 이미 디스크에 썼고 우리는 판정만 전달한다.

let server: FakeRuntimeServer | null = null
let connection: WsConnection | null = null

afterEach(async () => {
  connection?.dispose()
  connection = null
  await server?.stop()
  server = null
})

const REVIEW = {
  turnId: 'turn-1',
  chatTurnId: 'chat-1',
  status: 'PENDING_DECISION',
  files: [
    {
      path: 'src/a.ts',
      operation: 'modify',
      additions: 3,
      deletions: 1,
      baseline: 'a\nb\nc',
      modified: 'a\nx\ny\nz\nc',
      changeBlocks: [
        {
          kind: 'replace',
          oldRange: { startLine: 2, endLine: 2 },
          newRange: { startLine: 2, endLine: 4 },
          deletedText: 'b',
        },
      ],
    },
  ],
}

async function setup() {
  server = new FakeRuntimeServer()
  const port = await server.start()
  connection = new WsConnection({ url: `ws://127.0.0.1:${port}/ws`, autoReconnect: false })

  const reviews = new TurnReviewController(connection)
  const seen: TurnReview[][] = []
  reviews.onChange((all) => seen.push(all))
  reviews.start()

  const handshake = new Handshake(connection, { workspacePath: '/tmp' })
  const ready = handshake.run()
  await connection.connect()
  await ready

  return { reviews, seen, handshake, server: server!, connection: connection! }
}

describe('turn_changes 수신', () => {
  it('푸시를 받아 카드로 만든다 — replyTo 없는 푸시다', async () => {
    const ctx = await setup()
    ctx.server.push([turnChangesFrame(REVIEW)])

    await vi.waitFor(() => expect(ctx.reviews.all).toHaveLength(1))
    const review = ctx.reviews.all[0]!
    expect(review.turnId).toBe('turn-1')
    expect(review.status).toBe(TurnReviewStatus.PENDING_DECISION)
    expect(review.files[0]!.changeBlocks).toHaveLength(1)
    ctx.handshake.dispose()
  })

  it('같은 turnId 가 다시 오면 갱신한다', async () => {
    const ctx = await setup()
    ctx.server.push([turnChangesFrame(REVIEW)])
    await vi.waitFor(() => expect(ctx.reviews.all).toHaveLength(1))

    ctx.server.push([turnChangesFrame({ ...REVIEW, status: 'ACCEPTING' })])

    await vi.waitFor(() => expect(ctx.reviews.all[0]!.status).toBe(TurnReviewStatus.ACCEPTING))
    expect(ctx.reviews.all).toHaveLength(1)
    ctx.handshake.dispose()
  })

  it('턴이 여럿이면 각각 유지된다', async () => {
    const ctx = await setup()
    ctx.server.push([turnChangesFrame(REVIEW), turnChangesFrame({ ...REVIEW, turnId: 'turn-2' })])

    await vi.waitFor(() => expect(ctx.reviews.all).toHaveLength(2))
    ctx.handshake.dispose()
  })

  it('turnId 없는 페이로드는 무시한다', async () => {
    const ctx = await setup()
    ctx.server.push([turnChangesFrame({ status: 'ACCEPTED', files: [] })])

    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(ctx.reviews.all).toHaveLength(0)
    ctx.handshake.dispose()
  })
})

describe('판정 전송', () => {
  it('accept 는 turn_ack 로 나간다', async () => {
    const ctx = await setup()
    ctx.server.push([turnChangesFrame(REVIEW)])
    await vi.waitFor(() => expect(ctx.reviews.all).toHaveLength(1))

    expect(ctx.reviews.decide('turn-1', 'accept')).toBe(true)

    await vi.waitFor(() => {
      const sent = ctx.server.received.find((f) => f.action === 'turn_ack')
      expect(sent?.data).toEqual({ turnId: 'turn-1' })
    })
    ctx.handshake.dispose()
  })

  it('reject 는 turn_reject 로 나간다', async () => {
    const ctx = await setup()
    ctx.server.push([turnChangesFrame(REVIEW)])
    await vi.waitFor(() => expect(ctx.reviews.all).toHaveLength(1))

    ctx.reviews.decide('turn-1', 'reject')

    await vi.waitFor(() => {
      expect(ctx.server.received.some((f) => f.action === 'turn_reject')).toBe(true)
    })
    ctx.handshake.dispose()
  })

  it('파일을 지정하면 부분 거부가 된다', async () => {
    const ctx = await setup()
    ctx.server.push([turnChangesFrame(REVIEW)])
    await vi.waitFor(() => expect(ctx.reviews.all).toHaveLength(1))

    ctx.reviews.decide('turn-1', 'reject', ['src/a.ts'])

    await vi.waitFor(() => {
      const sent = ctx.server.received.find((f) => f.action === 'turn_reject')
      expect(sent?.data).toEqual({ turnId: 'turn-1', filePaths: ['src/a.ts'] })
    })
    ctx.handshake.dispose()
  })

  it('판정하면 상태가 갱신돼 돌아온다', async () => {
    const ctx = await setup()
    ctx.server.push([turnChangesFrame(REVIEW)])
    await vi.waitFor(() => expect(ctx.reviews.all).toHaveLength(1))

    ctx.reviews.decide('turn-1', 'accept')

    await vi.waitFor(() => {
      const review = ctx.reviews.all[0]!
      expect(review.status).toBe(TurnReviewStatus.ACCEPTED)
      expect(review.isFinalized).toBe(true)
    })
    ctx.handshake.dispose()
  })

  it('모르는 turnId 는 보내지 않는다', async () => {
    const ctx = await setup()
    expect(ctx.reviews.decide('없는턴', 'accept')).toBe(false)
    ctx.handshake.dispose()
  })

  it('최종 상태는 더 손댈 수 없다', async () => {
    const ctx = await setup()
    ctx.server.push([turnChangesFrame({ ...REVIEW, status: 'FAILED' })])
    await vi.waitFor(() => expect(ctx.reviews.all).toHaveLength(1))

    expect(ctx.reviews.decide('turn-1', 'accept')).toBe(false)
    ctx.handshake.dispose()
  })

  it('잠정 상태는 뒤집을 수 있다 — isFinalized 가 없으면 확정이 아니다', async () => {
    const ctx = await setup()
    ctx.server.push([turnChangesFrame({ ...REVIEW, status: 'ACCEPTED' })])
    await vi.waitFor(() => expect(ctx.reviews.all).toHaveLength(1))

    expect(ctx.reviews.decide('turn-1', 'reject')).toBe(true)
    ctx.handshake.dispose()
  })
})

describe('초기화', () => {
  it('새 대화를 시작하면 카드를 비운다', async () => {
    const ctx = await setup()
    ctx.server.push([turnChangesFrame(REVIEW)])
    await vi.waitFor(() => expect(ctx.reviews.all).toHaveLength(1))

    ctx.reviews.reset()
    expect(ctx.reviews.all).toEqual([])
    ctx.handshake.dispose()
  })

  it('되감기 알림에도 비운다', async () => {
    const ctx = await setup()
    ctx.server.push([turnChangesFrame(REVIEW)])
    await vi.waitFor(() => expect(ctx.reviews.all).toHaveLength(1))

    ctx.server.push([{ kind: 'diff', action: 'chat_rewound', data: {} }])

    await vi.waitFor(() => expect(ctx.reviews.all).toHaveLength(0))
    ctx.handshake.dispose()
  })
})
