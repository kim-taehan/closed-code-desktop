import { describe, expect, it, vi } from 'vitest'
import { PermissionMode } from '../../shared/protocol/kinds'
import { applyPermissionMode } from './agents'

function client() {
  return { setAgent: vi.fn(async () => {}) }
}

describe('권한 모드 → opencode 에이전트', () => {
  it('default 는 build 에이전트다', async () => {
    const c = client()
    const applied = await applyPermissionMode(c, 'ses_1', PermissionMode.DEFAULT, PermissionMode.PLAN)

    expect(c.setAgent).toHaveBeenCalledWith('ses_1', 'build')
    expect(applied).toBe(PermissionMode.DEFAULT)
  })

  it('plan 은 plan 에이전트다 — "Disallows all edit tools"', async () => {
    const c = client()
    const applied = await applyPermissionMode(c, 'ses_1', PermissionMode.PLAN, PermissionMode.DEFAULT)

    expect(c.setAgent).toHaveBeenCalledWith('ses_1', 'plan')
    expect(applied).toBe(PermissionMode.PLAN)
  })

  // opencode 는 없는 에이전트 이름도 204 로 받아 **세션에 그대로 저장한다**(실측).
  // 그래서 모르는 값은 보내기 전에 여기서 막아야 한다 — 서버는 막아 주지 않는다.
  it('모르는 모드는 보내지 않는다 — 세션에 없는 에이전트가 박히면 안 된다', async () => {
    const c = client()
    const applied = await applyPermissionMode(c, 'ses_1', 'acceptEdits', PermissionMode.DEFAULT)

    expect(c.setAgent).not.toHaveBeenCalled()
    expect(applied).toBe(PermissionMode.DEFAULT)
  })

  it('쓰레기 값도 지금 모드를 유지한다 — 화면이 그 값으로 정정된다', async () => {
    const c = client()
    for (const junk of [null, undefined, 42, '', 'build']) {
      expect(await applyPermissionMode(c, 'ses_1', junk, PermissionMode.PLAN)).toBe(PermissionMode.PLAN)
    }
    expect(c.setAgent).not.toHaveBeenCalled()
  })
})
