import { describe, expect, it } from 'vitest'
import { findOpencodeBinary, notFoundMessage } from './binary'

// 이 시험이 겨누는 것은 **PATH 가 비어 있어도 찾아내는가** 하나다.
// macOS 에서 GUI 로 띄운 앱의 PATH 는 `/usr/bin:/bin:/usr/sbin:/sbin` 뿐이라,
// PATH 만 보는 구현은 터미널에서 잘 돌다가 패키징한 앱에서만 죽는다.

const env = (overrides: Record<string, string>): NodeJS.ProcessEnv => ({
  HOME: '/Users/tester',
  PATH: '/usr/bin:/bin',
  ...overrides,
})

/** 이 경로들만 실행 가능한 척한다 */
const only = (...paths: string[]) => (path: string) => paths.includes(path)

describe('findOpencodeBinary', () => {
  it('PATH 에 있으면 거기서 찾는다', () => {
    const found = findOpencodeBinary(env({ PATH: '/opt/x/bin:/usr/bin' }), only('/opt/x/bin/opencode'))
    expect(found.path).toBe('/opt/x/bin/opencode')
    expect(found.source).toBe('PATH')
  })

  it('PATH 가 GUI 앱 수준으로 빈약해도 알려진 자리에서 찾는다', () => {
    // 실측 위치: bun 설치본이 `~/.bun/bin/opencode` 심볼릭 링크로 산다
    const found = findOpencodeBinary(env({}), only('/Users/tester/.bun/bin/opencode'))
    expect(found.path).toBe('/Users/tester/.bun/bin/opencode')
    expect(found.source).toBe('/Users/tester/.bun/bin')
  })

  it('OPENCODE_BIN 이 PATH 보다 먼저다 — 우리가 모르는 자리로 되돌아갈 길', () => {
    const found = findOpencodeBinary(
      env({ OPENCODE_BIN: '/custom/oc', PATH: '/usr/bin' }),
      only('/custom/oc', '/usr/bin/opencode'),
    )
    expect(found.path).toBe('/custom/oc')
    expect(found.source).toBe('OPENCODE_BIN')
  })

  it('OPENCODE_BIN 이 실행 불가면 넘어가되 본 자리로는 남는다', () => {
    const found = findOpencodeBinary(
      env({ OPENCODE_BIN: '/gone/oc', PATH: '/usr/bin' }),
      only('/usr/bin/opencode'),
    )
    expect(found.path).toBe('/usr/bin/opencode')
    expect(found.searched).toContain('/gone/oc (OPENCODE_BIN)')
  })

  it('못 찾으면 본 자리를 전부 돌려준다 — 이게 사용자에게 남는 유일한 단서다', () => {
    const found = findOpencodeBinary(env({}), () => false)
    expect(found.path).toBeNull()
    expect(found.searched).toContain('/usr/bin/opencode')
    expect(found.searched).toContain('/Users/tester/.bun/bin/opencode')
    expect(found.searched).toContain('/opt/homebrew/bin/opencode')
    // 같은 자리를 두 번 적지 않는다
    expect(new Set(found.searched).size).toBe(found.searched.length)
  })

  it('안내문에 본 자리가 그대로 실린다', () => {
    const message = notFoundMessage(findOpencodeBinary(env({}), () => false))
    expect(message).toContain('OPENCODE_BIN')
    expect(message).toContain('/Users/tester/.bun/bin/opencode')
  })
})
