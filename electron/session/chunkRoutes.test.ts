import { describe, expect, it } from 'vitest'
import { ALL_CHUNK_TYPES, ChunkType } from '../../shared/protocol/chunkTypes'
import { CHUNK_ROUTES, ChunkRoute, producesMessage, routeOf } from './chunkRoutes'
import { SAMPLE_CHUNKS, setup } from './chunkTestKit'

// ══════════════════════════════════════════════════════════════
//  렌더 매핑 전수 테스트 (설계 §9.1) — B2 관문
//
//  desktop2 의 "지맘대로 보여주고 안 보여주고" 재발을 막는 장치다.
//  타입마다 "메시지를 만든다 / 만들지 않는다"를 양쪽 다 단언하고,
//  표에 있는데 케이스가 없는 타입이 하나라도 있으면 실패한다.
// ══════════════════════════════════════════════════════════════

describe('매핑표 자체의 완전성', () => {
  it('모든 ChunkType 이 표에 실려 있다', () => {
    for (const type of ALL_CHUNK_TYPES) {
      expect(CHUNK_ROUTES[type], `${type} 이 매핑표에 없습니다`).toBeDefined()
    }
  })

  it('모든 ChunkType 에 대표 페이로드가 있다 — 없으면 전수 테스트가 그 타입을 건너뛴다', () => {
    for (const type of ALL_CHUNK_TYPES) {
      expect(SAMPLE_CHUNKS[type], `${type} 의 대표 페이로드가 없습니다`).toBeDefined()
    }
  })

  it('표에 없는 타입은 routeOf 가 undefined 를 준다', () => {
    expect(routeOf('aliens_landed')).toBeUndefined()
  })

  it('RENDERS 만 메시지를 만드는 경로다', () => {
    expect(producesMessage(ChunkRoute.RENDERS)).toBe(true)
    const others = [
      ChunkRoute.FOLDS,
      ChunkRoute.META_ONLY,
      ChunkRoute.INTERRUPT,
      ChunkRoute.DEFERRED,
      ChunkRoute.DROPPED,
    ]
    for (const route of others) expect(producesMessage(route)).toBe(false)
  })
})

describe('전수 — 화면에 새 요소를 만드는가', () => {
  // 표의 route 와 실제 동작이 일치하는지 타입마다 확인한다.
  for (const type of ALL_CHUNK_TYPES) {
    const route = CHUNK_ROUTES[type]
    const shouldProduce = producesMessage(route)
    const label = shouldProduce ? '메시지를 만든다' : '메시지를 만들지 않는다'

    it(`${type} (${route}) — ${label}`, () => {
      const { messages, turns, router } = setup()
      turns.onTurnStart('t1')

      // tool_result 는 짝이 될 tool_call 이 먼저 있어야 의미가 있다
      if (type === ChunkType.TOOL_RESULT) {
        router.route(SAMPLE_CHUNKS[ChunkType.TOOL_CALL]!)
      }
      const before = messages.messages.length

      const result = router.route(SAMPLE_CHUNKS[type]!, 'stream-1')

      expect(result.route).toBe(route)
      if (shouldProduce) {
        expect(messages.messages.length, `${type} 이 메시지를 만들지 않았습니다`).toBe(before + 1)
      } else {
        expect(messages.messages.length, `${type} 이 메시지를 만들었습니다`).toBe(before)
      }
    })
  }
})
