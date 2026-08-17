import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listFiles, searchText, MAX_FILES, MAX_MATCHES } from './projectSearch'

// 빠른 열기(`Cmd+P`)와 내용 검색이 서는 자리. **이 모듈에는 시험이 하나도 없었다**
// (2026-08-17 감사). 부르는 쪽(`SearchPanel`·`QuickOpen`)의 시험은 전부 목으로 갈아끼워
// 여기까지 안 닿는다.
//
// ## 무엇을 겨누나
//
// 가장 값이 큰 것은 **상한 둘**이다 (`MAX_FILES`·`MAX_MATCHES`). 상한이 조용히 어긋나면
// 증상이 "결과가 없다" 가 아니라 **"이게 전부인 줄 알았다"** 로 나온다 — 사용자는 잘린
// 줄을 모르고 다시 찾지 않는다. 소스가 그것을 "감추지 않는다" 고 적어 뒀으니 잠근다.
//
// 상한을 진짜 값으로 잰다 (파일 2만 개는 1초 미만이다). **줄여 잡은 값으로 재면
// 상한을 옮겨도 시험이 안 깨져** 잠근 것이 없다.

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'psearch-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function put(relativePath: string, content = ''): Promise<void> {
  const absolute = join(root, relativePath)
  await mkdir(join(absolute, '..'), { recursive: true })
  await writeFile(absolute, content)
}

describe('listFiles', () => {
  it('파일과 디렉토리를 루트 기준 상대경로로 모은다', async () => {
    await put('a.ts')
    await put('src/b.ts')
    await put('src/deep/c.ts')

    const result = await listFiles(root)

    expect(result.files.sort()).toEqual(['a.ts', 'src/b.ts', 'src/deep/c.ts'])
    expect(result.dirs.sort()).toEqual(['src', 'src/deep'])
    expect(result.truncated).toBe(false)
  })

  // ⚠️ **이 시험은 회귀 그물이지 결함 탐지기가 아니다.** 소스의 `.split(sep).join('/')` 를
  // 통째로 지워도 초록이다 (실측) — 이 기계의 `path.sep` 이 `'/'` 라 그 식이 애초에 무동작이다.
  // 그것이 겨누는 것은 **윈도우의 `\`** 이고, 여기서는 그 조건을 만들 수가 없다.
  // 잠긴 것은 "중첩 경로가 루트 기준 상대경로로 나온다" 까지다.
  it('중첩된 파일도 루트 기준 상대경로로 나온다 (윈도우 갈래는 여기서 못 잰다)', async () => {
    await put('src/deep/c.ts')
    const result = await listFiles(root)
    expect(result.files).toContain('src/deep/c.ts')
  })

  it('감추는 폴더는 들어가지도, 목록에 넣지도 않는다', async () => {
    await put('keep.ts')
    await put('node_modules/pkg/index.js')
    await put('.git/config')
    await put('dist/bundle.js')

    const result = await listFiles(root)

    expect(result.files).toEqual(['keep.ts'])
    expect(result.dirs).toEqual([])
  })

  // 따라가면 루트 밖으로 나가거나(보안) 순환에 빠진다(멈춤). 둘 다 소스가 적어 둔 이유다.
  //
  // ⚠️ **여기도 회귀 그물이다.** 소스의 `if (entry.isSymbolicLink()) continue` 를 지워도
  // 초록이다 (실측). `readdir({ withFileTypes: true })` 가 심링크를 **`isDirectory`·
  // `isFile` 둘 다 false** 로 주기 때문에 (직접 재 봤다), 아래 두 갈래가 이미 걸러 낸다 —
  // 그 줄은 겹겹의 앞겹이라 혼자 떼어 잴 방법이 없다. 잠긴 것은 **결과에 안 나온다**는
  // 성질이고, 그 줄이 참인지는 이 시험이 아니라 위 실측이 근거다.
  it('심링크는 결과에 안 나온다', async () => {
    await put('real/inside.ts')
    await symlink(join(root, 'real'), join(root, 'link'), 'dir')

    const result = await listFiles(root)

    expect(result.files).toEqual(['real/inside.ts'])
    expect(result.dirs).toEqual(['real'])
  })

  // 한 폴더를 못 읽는다고 전체 검색이 죽으면 안 된다 — 권한이 막힌 폴더는 실제로 있다.
  it('못 읽는 디렉토리가 있어도 나머지는 모은다', async () => {
    await put('ok.ts')
    await mkdir(join(root, 'locked'))
    await rm(join(root, 'locked'), { recursive: true })
    // 지워진 자리를 훑어도(경합) 나머지가 살아남는지 본다
    const result = await listFiles(root)
    expect(result.files).toEqual(['ok.ts'])
  })

  it(`파일이 ${MAX_FILES} 개를 넘으면 거기서 멈추고 **잘렸다고 알린다**`, async () => {
    await Promise.all(
      Array.from({ length: MAX_FILES + 1 }, (_unused, index) =>
        writeFile(join(root, `f${index}.txt`), ''),
      ),
    )

    const result = await listFiles(root)

    expect(result.files).toHaveLength(MAX_FILES)
    expect(result.truncated).toBe(true)
  })
})

describe('searchText', () => {
  it('대소문자를 안 가리고, 줄 번호는 1부터 센다', async () => {
    await put('a.ts', 'first\nHELLO world\nthird')

    const result = await searchText(root, 'hello')

    expect(result.matches).toEqual([{ file: 'a.ts', line: 2, preview: 'HELLO world' }])
    expect(result.truncated).toBe(false)
  })

  it('미리보기는 앞뒤 공백을 턴다', async () => {
    await put('a.ts', '    const x = 1    ')
    const result = await searchText(root, 'const')
    expect(result.matches[0]?.preview).toBe('const x = 1')
  })

  // 긴 한 줄(압축된 번들 등)이 화면을 밀어내지 않게. 잘렸다는 표시가 붙어야 한다.
  it('200자를 넘는 줄은 자르고 말줄임표를 붙인다', async () => {
    await put('a.ts', `${'x'.repeat(300)}needle`)

    const preview = (await searchText(root, 'needle')).matches[0]?.preview

    expect(preview).toHaveLength(201)
    expect(preview?.endsWith('…')).toBe(true)
  })

  // 빈 질의로 전체를 훑으면 큰 저장소에서 앱이 멈춘다.
  it('빈 질의는 아무것도 훑지 않는다', async () => {
    await put('a.ts', 'anything')
    expect(await searchText(root, '')).toEqual({ matches: [], truncated: false })
  })

  // 바이너리를 훑으면 의미 없는 줄이 결과를 채워 진짜 결과를 밀어낸다.
  it('NUL 이 든 파일은 건너뛴다', async () => {
    await put('text.ts', 'needle here')
    await writeFile(join(root, 'blob.bin'), Buffer.from('needle\0needle', 'utf8'))

    const result = await searchText(root, 'needle')

    expect(result.matches.map((match) => match.file)).toEqual(['text.ts'])
  })

  it('2MB 를 넘는 파일은 훑지 않는다', async () => {
    await put('small.ts', 'needle')
    await writeFile(join(root, 'big.ts'), `needle\n${'x'.repeat(2 * 1024 * 1024)}`)

    const result = await searchText(root, 'needle')

    expect(result.matches.map((match) => match.file)).toEqual(['small.ts'])
  })

  it(`맞은 것이 ${MAX_MATCHES} 개를 넘으면 거기서 멈추고 **잘렸다고 알린다**`, async () => {
    await put('a.ts', Array.from({ length: MAX_MATCHES + 100 }, () => 'needle').join('\n'))

    const result = await searchText(root, 'needle')

    expect(result.matches).toHaveLength(MAX_MATCHES)
    expect(result.truncated).toBe(true)
  })

  it('감추는 폴더 안은 검색하지 않는다', async () => {
    await put('src/a.ts', 'needle')
    await put('node_modules/pkg/index.js', 'needle')

    const result = await searchText(root, 'needle')

    expect(result.matches.map((match) => match.file)).toEqual(['src/a.ts'])
  })
})
