import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveInside } from './resolveInside'

// 확장 체계와 파일 트리가 공유하는 경계. 여기가 뚫리면 루트 밖 파일이 열린다.
// 경로는 renderer / 확장 매니페스트가 만들어 보내므로 이 판정을 믿을 수 있어야 한다.
//
// `vi.mock('node:fs')` 를 쓰지 않는다 — realpath 로 심링크를 펴는 것이 이 함수의 핵심이라
// 가짜 fs 로는 정작 잠그려는 것을 못 잠근다. 이 레포 관례이기도 하다.

let workDir = ''
let root = ''
let outside = ''

beforeEach(async () => {
  // macOS 의 /var → /private/var 처럼 tmpdir 자체가 심링크다.
  // 루트를 미리 펴두지 않으면 모든 케이스가 "밖" 으로 잡힌다.
  workDir = await realpath(await mkdtemp(join(tmpdir(), 'davis-guard-')))
  root = join(workDir, 'root')
  outside = join(workDir, 'secrets')

  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(outside, { recursive: true })
  await writeFile(join(root, 'src', 'index.ts'), '', 'utf8')
  await writeFile(join(outside, 'password.txt'), 'secret', 'utf8')
})

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true })
})

describe('안쪽 경로', () => {
  it('상대경로를 실경로로 돌려준다', async () => {
    expect(await resolveInside(root, 'src/index.ts')).toBe(join(root, 'src', 'index.ts'))
  })

  it('빈 상대경로는 루트 자신이다 — 루트도 안쪽으로 본다', async () => {
    expect(await resolveInside(root, '')).toBe(root)
  })

  it('루트 자체가 심링크여도 실경로 기준으로 판정한다', async () => {
    const alias = join(workDir, 'alias')
    await symlink(root, alias)

    // 별칭으로 들어와도 결과는 실경로다 — 밖으로 오판하지 않는다
    expect(await resolveInside(alias, 'src')).toBe(join(root, 'src'))
  })
})

describe('탈출 시도', () => {
  it('.. 로 위로 나가면 거부한다', async () => {
    expect(await resolveInside(root, '../secrets')).toBeNull()
  })

  it('겹겹의 .. 도 거부한다', async () => {
    expect(await resolveInside(root, 'src/../../secrets/password.txt')).toBeNull()
  })

  // join 이 절대경로를 루트 아래 세그먼트로 붙여버려 존재하지 않는 경로가 된다.
  // 결과적으로 거부되며, 설령 존재하더라도 그건 루트 안쪽이다.
  it('절대경로를 넘겨도 루트 밖이면 거부한다', async () => {
    expect(await resolveInside(root, outside)).toBeNull()
    expect(await resolveInside(root, join(outside, 'password.txt'))).toBeNull()
  })

  // 이 함수가 startsWith 에 sep 을 붙이는 이유. 구분자를 안 붙이면 안쪽으로 잡힌다.
  it('루트 이름으로 시작하는 형제 디렉토리는 밖이다 — 접두사 함정', async () => {
    const sibling = `${root}abc`
    await mkdir(join(sibling, 'src'), { recursive: true })

    expect(await resolveInside(root, '../rootabc')).toBeNull()
    expect(await resolveInside(root, '../rootabc/src')).toBeNull()
  })

  // 문자열 비교만으로는 못 잡는다 — 경로상으로는 루트 안쪽으로 보인다.
  // realpath 를 쓰는 이유가 바로 이 케이스다.
  // Windows 는 심링크 생성에 권한이 필요해 건너뛴다 (파일 트리 쪽 projectFs.test.ts 도 같은 케이스를 둔다).
  describe.skipIf(process.platform === 'win32')('심링크', () => {
    it('루트 안의 심링크가 밖의 디렉토리를 가리키면 거부한다', async () => {
      await symlink(outside, join(root, 'escape'))

      expect(await resolveInside(root, 'escape')).toBeNull()
      expect(await resolveInside(root, 'escape/password.txt')).toBeNull()
    })

    it('루트 안의 심링크가 밖의 파일을 가리켜도 거부한다', async () => {
      await symlink(join(outside, 'password.txt'), join(root, 'leak.txt'))

      expect(await resolveInside(root, 'leak.txt')).toBeNull()
    })

    it('루트 안을 가리키는 심링크는 허용한다 — 심링크 자체를 막는 것이 아니다', async () => {
      await symlink(join(root, 'src'), join(root, 'link-to-src'))

      expect(await resolveInside(root, 'link-to-src/index.ts')).toBe(
        join(root, 'src', 'index.ts'),
      )
    })
  })
})

describe('열 수 없는 경로', () => {
  // 원본(projectFs 의 private 메서드)이 realpath 예외를 그대로 null 로 삼켰다.
  // 추출하면서 바꾸지 않았다 — 호출부가 전부 '거부' 로 읽는다.
  it('없는 경로는 null 이다', async () => {
    expect(await resolveInside(root, '없음/파일.txt')).toBeNull()
  })

  it('루트가 없으면 null 이다', async () => {
    expect(await resolveInside(join(workDir, '없는루트'), 'src')).toBeNull()
  })
})
