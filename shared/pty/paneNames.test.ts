import { describe, expect, it } from 'vitest'
import { isShellPane, SHELL_PANE } from './paneNames'

describe('isShellPane', () => {
  // 「추가」로 늘어난 칸도 사용자가 손으로 치는 자리다 (`drawerTabs.ts` 의 `addPane`).
  // 여기서 false 가 나오면 `run_project` 가 그 칸에 명령을 밀어 넣는다.
  it('shell 과 shell-N 을 함께 본다', () => {
    expect(isShellPane(SHELL_PANE)).toBe(true)
    expect(isShellPane('shell-2')).toBe(true)
    expect(isShellPane('shell-27')).toBe(true)
  })

  // 반대로 여기서 true 가 나오면 모델이 멀쩡한 이름을 거절당한다.
  it('앞이 겹칠 뿐인 이름은 셸이 아니다', () => {
    expect(isShellPane('shellcheck')).toBe(false)
    expect(isShellPane('dev')).toBe(false)
    expect(isShellPane('')).toBe(false)
  })
})
