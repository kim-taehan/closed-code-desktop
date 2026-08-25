import { describe, expect, it } from 'vitest'
import { bundledBinary, findOpencodeBinary, notFoundMessage } from './binary'

// 이 시험이 겨누는 것은 **PATH 가 비어 있어도 찾아내는가** 하나다.
// macOS 에서 GUI 로 띄운 앱의 PATH 는 `/usr/bin:/bin:/usr/sbin:/sbin` 뿐이라,
// PATH 만 보는 구현은 터미널에서 잘 돌다가 패키징한 앱에서만 죽는다.
//
// 여기에 **동봉본이 PATH 를 이기는가**가 붙었다 (2026-08-25). 폐쇄망 현장 머신에
// 우연히 있던 다른 버전이 이기면 안 된다 — 하한선 미달이 "이벤트가 안 온다" 로 보인다.

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

const BUNDLED = '/App.app/Contents/Resources/opencode/opencode'

describe('동봉본 (패키징한 앱에 실려 간 실행 파일)', () => {
  it('PATH 에도 있으면 동봉본이 이긴다 — 앱과 짝이 맞춰진 것만 쓴다', () => {
    const found = findOpencodeBinary(
      env({ PATH: '/usr/local/bin' }),
      only(BUNDLED, '/usr/local/bin/opencode'),
      BUNDLED,
    )
    expect(found.path).toBe(BUNDLED)
    expect(found.source).toBe('앱에 동봉')
  })

  it('OPENCODE_BIN 은 동봉본보다도 앞이다 — 탈출구는 남는다', () => {
    const found = findOpencodeBinary(env({ OPENCODE_BIN: '/custom/oc' }), only('/custom/oc', BUNDLED), BUNDLED)
    expect(found.path).toBe('/custom/oc')
    expect(found.source).toBe('OPENCODE_BIN')
  })

  it('동봉본이 없으면 PATH 로 넘어가되 본 자리로는 남는다', () => {
    const found = findOpencodeBinary(env({ PATH: '/usr/local/bin' }), only('/usr/local/bin/opencode'), BUNDLED)
    expect(found.path).toBe('/usr/local/bin/opencode')
    // 여기까지 왔다는 것은 fetch 없이 패키징했다는 뜻이다 — 목록에 남아야 진단이 된다
    expect(found.searched).toContain(`${BUNDLED} (앱에 동봉)`)
  })

  it('비패키징(개발 모드)에서는 동봉 후보를 아예 안 본다', () => {
    // `npm run dev` 의 resourcesPath 는 node_modules 의 electron 배포물이다 — 거짓 자리다
    expect(bundledBinary({ resourcesPath: '/repo/node_modules/electron/dist/…', defaultApp: true, platform: 'darwin' })).toBeNull()
    // 순수 node (단위 시험·스크립트) 에는 resourcesPath 자체가 없다
    expect(bundledBinary({ platform: 'darwin' })).toBeNull()

    const found = findOpencodeBinary(env({}), () => false, null)
    expect(found.searched.some((entry) => entry.includes('동봉'))).toBe(false)
  })

  it('패키징한 앱의 자리는 리소스 밑 opencode/ 다 — Windows 만 이름이 다르다', () => {
    const mac = { resourcesPath: '/App.app/Contents/Resources', platform: 'darwin' }
    expect(bundledBinary(mac)).toBe(BUNDLED)
    expect(bundledBinary({ resourcesPath: 'C:\\app\\resources', platform: 'win32' })).toContain('opencode.exe')
  })
})
