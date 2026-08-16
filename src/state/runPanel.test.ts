import { describe, expect, it } from 'vitest'
import { runSourceLine, runState, runStateLabel } from './runPanel'

// 점 하나가 사용자에게 하는 말은 「지금 도는가」다. 틀리면 두 방향 다 나쁘다 —
// 죽은 서버가 초록이면 왜 안 되는지를 딴 데서 찾고, 도는 서버가 회색이면 겹쳐 띄운다.

describe('runState', () => {
  it('탭이 열려 있으면 도는 중', () => {
    expect(runState('dev', ['shell', 'dev'], undefined)).toBe('running')
  })

  it('안 띄운 것은 멈춤', () => {
    expect(runState('dev', ['shell'], undefined)).toBe('idle')
  })

  // 이 케이스가 이 파일의 이유. 프로세스가 죽어도 탭은 화면에 남는다
  // (`DrawerTerminal` 이 "[셸이 끝났습니다]" 를 찍고 그대로 있다).
  it('끝났으면 탭이 남아 있어도 도는 중이 아니다', () => {
    expect(runState('dev', ['shell', 'dev'], 1)).toBe('error')
    expect(runState('dev', ['shell', 'dev'], 0)).toBe('idle')
  })

  // 실패했다는 증거가 없는데 빨간 점을 켜면 사용자는 있지도 않은 문제를 찾는다
  it('종료 코드를 못 읽었으면 오류로 치지 않는다', () => {
    expect(runState('dev', ['shell', 'dev'], null)).toBe('idle')
  })
})

describe('runStateLabel', () => {
  it('실패한 것만 코드를 적는다 — 멈춤은 아무 말도 안 한다', () => {
    expect(runStateLabel('running', undefined)).toBe('도는 중')
    expect(runStateLabel('error', 1)).toBe('실패 · exit 1')
    expect(runStateLabel('idle', 0)).toBe('')
  })
})

describe('runSourceLine', () => {
  it('「목록이 없다」와 「목록이 비었다」를 가른다 — 사용자가 다음에 할 일이 다르다', () => {
    expect(runSourceLine(false, 0)).toContain('없습니다')
    expect(runSourceLine(true, 0)).toContain('비어 있습니다')
    expect(runSourceLine(true, 2)).toContain('기억해 둔')
  })
})
