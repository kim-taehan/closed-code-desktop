import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExtensionService } from '../../electron/extensions/service'
import { ExtensionWorkspace } from '../../electron/extensions/workspaceApi'
import { LiveChild } from '../../tests/extensions/liveChild'

// 확장 「코드 지도」를 **레포 원본 그대로** 태운다 (`screenScenario.test.ts` 선례).
//
// 프로세스 경계(utilityProcess)만 가짜다. 그 안쪽은 전부 진짜다 — registry 훑기 ·
// 매니페스트 파싱 · require · activate · `code.*` 왕복 · wasm 적재 · 파싱 · 화면 생성.
// **매니페스트가 틀려도 단위 시험은 초록**이라, 정작 앱에 안 뜨는 것을 못 잡는다.

const EXTENSIONS_DIR = join(__dirname, '..')
const BOARD = 'codeMap.board'

const created: string[] = []
let projectRoot: string

beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), 'code-map-'))
  created.push(base)
  // macOS 의 /var → /private/var. 안 펴면 경계 판정이 전부 "밖" 이 된다.
  projectRoot = await realpath(base)
})

afterEach(async () => {
  while (created.length > 0) await rm(created.pop() as string, { recursive: true, force: true })
})

async function write(relativePath: string, body: string): Promise<void> {
  const target = join(projectRoot, relativePath)
  await mkdir(join(target, '..'), { recursive: true })
  await writeFile(target, body, 'utf8')
}

/** 메모리 저장소. 진짜 디스크 저장소와 계약이 같다 (`storageStore.ts`) */
function memoryStorage() {
  const bag = new Map<string, unknown>()
  const at = (extension: string, project: string | null, key: string) => `${extension} ${project ?? ''} ${key}`
  return {
    get: (e: string, p: string | null, k: string) => Promise.resolve(bag.get(at(e, p, k))),
    set: (e: string, p: string | null, k: string, v: unknown) => {
      bag.set(at(e, p, k), v)
      return Promise.resolve()
    },
  }
}

function startService() {
  const html = new Map<string, string>()
  const project = { id: 'p1', root: projectRoot }
  const service = new ExtensionService({
    entryPath: 'ignored',
    fork: () => new LiveChild(),
    extensionsDir: EXTENSIONS_DIR,
    workspace: new ExtensionWorkspace(() => ({ active: project, openProjects: [project] })),
    storage: memoryStorage(),
    askText: vi.fn(() => Promise.resolve(null)),
  })
  service.onViewHtml((viewId, body) => html.set(viewId, body))
  service.start()
  return { service, html }
}

/** 서로를 수입하는 작은 프로젝트. TypeScript 상대 수입과 Kotlin 패키지 수입을 함께 둔다 */
async function sampleProject() {
  await write('src/center.ts', "import { helper } from './helper'\nexport class Center {\n  run() { return helper() }\n}\n")
  await write('src/helper.ts', 'export function helper() { return 1 }\n')
  await write('src/user.ts', "import { Center } from './center'\nexport const use = () => new Center()\n")
  // center.ts 를 **둘이** 수입한다 — 동점이면 처음 열리는 파일이 훑는 순서로 갈린다
  await write('src/other.ts', "import { Center } from './center'\nexport const also = () => new Center()\n")
  await write('src/View.tsx', 'export function View() {\n  return <div className="x">안녕</div>\n}\n')
  await write('kt/Domain.kt', 'package a.b\nclass Domain\n')
  await write('kt/Service.kt', 'package a.b\nimport a.b.Domain\nclass Service {\n  fun run() {}\n}\n')
}

describe('코드 지도 확장 — 무수정으로 도는가', () => {
  it('목록에 뜨고 싣기 실패가 없다', async () => {
    const { service } = startService()

    const listing = await service.listExtensions()

    expect(listing.extensions.map((one) => one.manifest.name), '매니페스트를 못 읽으면 여기서 사라진다').toContain('code-map')
    // 건너뛴 것은 **디렉토리 경로**로 온다 (`ExtensionSkip.dir`). 우리 자리가 거기 있으면
    // 매니페스트를 못 읽었거나 싣기가 실패한 것이고, 사유가 함께 온다 — 그대로 드러낸다
    expect(listing.skipped.filter((one) => one.dir.endsWith('/code-map'))).toEqual([])
    service.dispose()
  })

  it('지도가 없으면 그렇다고 말한다', async () => {
    const { service, html } = startService()

    await service.runCommand('codeMap.open', 'p1')

    expect(html.get(BOARD)).toContain('아직 지도가 없습니다')
  })

  /**
   * **여기가 이 시험의 값어치다.** wasm 적재부터 화면 생성까지 한 번에 지난다 —
   * 문법 경로가 틀리면 심볼이 0개가 되는데, 그건 예외가 아니라 빈 결과라 단위 시험으로는
   * 안 잡힌다.
   */
  it('지도를 만들면 단면도와 심볼이 화면에 뜬다', async () => {
    await sampleProject()
    const { service, html } = startService()

    await service.runCommand('codeMap.build', 'p1')
    const body = html.get(BOARD) ?? ''

    // 모든 파일이 단면도에 셀로 선다 — 누르면 옮겨 갈 수 있어야 한다
    expect(body).toContain('data-arg="src/center.ts"')
    expect(body).toContain('data-arg="kt/Domain.kt"')
    // 층 이름을 못 찾는 픽스처라 폴더 모드다. 그 사실을 화면이 말한다
    expect(body).toContain('방향은 재지 않습니다')
  })

  /**
   * **가장 많이 참조되는 것과 가장 크게 흔드는 것은 다르다.** 이 작은 픽스처에서도 갈린다:
   * `center.ts` 는 직접 들어옴이 2(user·other)로 1위지만, `helper.ts` 는 1(center)뿐인데
   * 그 뒤로 user·other 가 더 매달려 반경이 3이다. 처음 여는 자리는 반경 쪽이다.
   */
  it('직접 참조 1위가 아니라 반경 1위를 연다', async () => {
    await sampleProject()
    const { service, html } = startService()

    await service.runCommand('codeMap.build', 'p1')
    const body = html.get(BOARD) ?? ''

    expect(body, 'helper.ts 의 심볼이 옆에 떠 있어야 한다').toContain('data-open="src/helper.ts"')
    expect(body).toContain('1촌 1')
    expect(body).toContain('2촌 2')
  })

  /**
   * ⚠️ **활성 파일은 `{ path, line? }` 객체로 온다** (`extensionLoader.ts` 의 `ActiveFileRef`).
   * 한동안 문자열로 받고 있었고, 그러면 비교가 언제나 거짓이라 **예외 없이 아무 일도
   * 안 일어났다.** 화면이 안 바뀌는 것이 유일한 증상이라 눈으로는 못 잡는다.
   */
  it('편집기에서 파일을 옮기면 지도가 따라간다', async () => {
    await sampleProject()
    const { service, html } = startService()

    await service.runCommand('codeMap.build', 'p1')
    await service.activeFileChanged({ path: 'kt/Domain.kt', line: 2 }, 'p1')

    expect(html.get(BOARD) ?? '').toContain('data-open="kt/Domain.kt"')
  })

  /**
   * 프로젝트 트리 우클릭으로 들어오는 길. **지도가 아직 없을 수 있다** — 사용자는 확장
   * 패널을 연 적도 없이 파일을 우클릭했다. `focus` 를 그대로 부르면 조건에서 걸려
   * 아무 일도 안 일어나므로, 없으면 먼저 만든다.
   */
  it('지도가 없어도 우클릭 진입은 지도를 만들고 그 파일을 연다', async () => {
    await sampleProject()
    const { service, html } = startService()

    // build 를 한 번도 안 불렀다
    await service.runCommand('codeMap.reveal', 'p1', ['kt/Domain.kt'])

    expect(html.get(BOARD) ?? '').toContain('data-open="kt/Domain.kt"')
  })

  /**
   * ⚠️ **부르는 자리가 둘이고 인자 모양이 다르다.** 화면 다리는 문자열 하나를,
   * 파일 트리 우클릭은 `selection` 배열을 보낸다. 한쪽만 받으면 다른 쪽이 **예외 없이
   * 조용히** 죽는다.
   */
  it('문자열로 와도 배열로 와도 같은 파일을 연다', async () => {
    await sampleProject()
    const { service, html } = startService()

    await service.runCommand('codeMap.build', 'p1')
    await service.runCommand('codeMap.focus', 'p1', 'kt/Domain.kt')
    const fromString = html.get(BOARD)

    await service.runCommand('codeMap.focus', 'p1', 'src/helper.ts')
    await service.runCommand('codeMap.focus', 'p1', ['kt/Domain.kt'])

    expect(html.get(BOARD)).toBe(fromString)
  })

  it('지도에 없는 파일을 열면 화면을 안 바꾼다', async () => {
    await sampleProject()
    const { service, html } = startService()

    await service.runCommand('codeMap.build', 'p1')
    const before = html.get(BOARD)

    await service.activeFileChanged({ path: 'readme.md' }, 'p1')

    expect(html.get(BOARD)).toBe(before)
  })

  /** `.tsx` 문법을 안 실으면 이 파일만 조용히 빈 결과가 된다 */
  it('tsx 도 읽는다', async () => {
    await sampleProject()
    const { service, html } = startService()

    await service.runCommand('codeMap.build', 'p1')
    await service.runCommand('codeMap.focus', 'p1', 'src/View.tsx')

    expect(html.get(BOARD)).toContain('data-open="src/View.tsx"')
    expect(html.get(BOARD)).toContain('View')
  })

  /** Kotlin 수입은 패키지 경로라 상대 해석이 안 통한다 — 선언한 파일로 이어져야 한다 */
  it('Kotlin 파일 사이에도 선을 긋는다', async () => {
    await sampleProject()
    const { service, html } = startService()

    await service.runCommand('codeMap.build', 'p1')
    await service.runCommand('codeMap.focus', 'p1', 'kt/Domain.kt')
    const body = html.get(BOARD) ?? ''

    expect(body).toContain('data-open="kt/Domain.kt"')
    expect(body, 'Service.kt 가 Domain 을 수입하므로 1촌이다').toContain('1촌 1')
  })

  /**
   * 화면에서 노드를 누르면 오는 길. **인자는 문자열 하나**뿐이다.
   * 지도에 없는 경로를 주면 **가만히 있어야 한다** — 화면이 갑자기 비면 깨진 줄로 읽는다.
   */
  it('모르는 경로로 옮기라고 하면 화면을 안 바꾼다', async () => {
    await sampleProject()
    const { service, html } = startService()

    await service.runCommand('codeMap.build', 'p1')
    const before = html.get(BOARD)

    await service.runCommand('codeMap.focus', 'p1', 'src/없는파일.ts')

    expect(html.get(BOARD)).toBe(before)
  })

  it('읽을 파일이 없으면 지도를 만들지 않는다', async () => {
    await write('readme.md', '# 빈 프로젝트\n')
    const { service, html } = startService()

    await service.runCommand('codeMap.build', 'p1')

    expect(html.get(BOARD) ?? '').not.toContain('data-open')
  })
})
