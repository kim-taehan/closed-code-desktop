import { describe, expect, it } from 'vitest'
import { projectStatus } from './projectStatus'
import { EMPTY_SLICE, type SessionSlice } from './sessionSlice'
import type { ConnectionState, HandshakeStage } from '../../shared/ipc/sessionTypes'

// 탭 배지의 근거. 여기서 틀리면 사용자가 끝난 작업을 계속 기다리거나,
// 죽은 세션을 살아 있다고 믿는다.

function slice(
  stage: HandshakeStage,
  extra: Partial<SessionSlice> = {},
  connection?: ConnectionState,
): SessionSlice {
  return {
    ...EMPTY_SLICE,
    session: { handshake: { stage }, ...(connection ? { connection } : {}) },
    ...extra,
  }
}

describe('프로젝트 상태', () => {
  it('세션이 없으면 연결 안 됨이다 — 지연 연결의 기본', () => {
    expect(projectStatus(undefined)).toBe('idle')
    expect(projectStatus(EMPTY_SLICE)).toBe('idle')
  })

  it('핸드셰이크 중이면 연결 중이다', () => {
    expect(projectStatus(slice('awaiting_connected'))).toBe('connecting')
    expect(projectStatus(slice('authenticating'))).toBe('connecting')
    expect(projectStatus(slice('syncing_workspace'))).toBe('connecting')
  })

  it('준비되면 준비됨이다', () => {
    expect(projectStatus(slice('ready'))).toBe('ready')
  })

  it('턴이 도는 동안 작업 중이다', () => {
    expect(projectStatus(slice('ready', { isStreaming: true }))).toBe('busy')
  })

  it('승인 대기도 작업 중이다 — 사용자가 손대야 진행된다', () => {
    const waiting = { approvals: [{ requestId: 'r1', toolName: 'edit_file' }] }
    expect(projectStatus(slice('ready', waiting))).toBe('busy')
  })

  it('실패는 오류다', () => {
    expect(projectStatus(slice('failed'))).toBe('error')
  })

  // 실패한 세션이 승인 대기를 남겨둔 채 끝나면, 바쁨으로 보여 끝나기를 기다리게 된다
  it('오류가 작업 중보다 우선한다', () => {
    const stuck = { isStreaming: true, approvals: [{ requestId: 'r1', toolName: 'x' }] }
    expect(projectStatus(slice('failed', stuck))).toBe('error')
  })

  it('소켓이 끊기면 연결 끊김이다 — 핸드셰이크가 ready 로 남아 있어도', () => {
    expect(projectStatus(slice('ready', {}, 'closed'))).toBe('disconnected')
    expect(projectStatus(slice('ready', {}, 'reconnecting'))).toBe('disconnected')
  })

  // 소켓이 죽었으면 그 턴은 진행되지 않는다 — 기다리게 두면 안 된다
  it('연결 끊김이 작업 중보다 우선한다', () => {
    expect(projectStatus(slice('ready', { isStreaming: true }, 'closed'))).toBe('disconnected')
  })

  it('열린 소켓은 상태에 영향을 주지 않는다', () => {
    expect(projectStatus(slice('ready', {}, 'open'))).toBe('ready')
  })
})
