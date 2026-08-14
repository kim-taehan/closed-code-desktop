import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findOpencodeBinary, notFoundMessage } from './binary'
import { startOpencodeServer } from './serverProcess'

// 진짜 `opencode serve` 를 띄워 보는 검증. **기본으로는 건너뛴다** (CI 에 바이너리가 없다):
//
//   OPENCODE_LIVE=1 npx vitest run electron/opencode/serverProcessLive.test.ts
//
// 가짜 자식 프로세스로는 절대 안 잡히는 것을 겨눈다 —
//   · `--port` 없이 띄우면 정말로 빈 포트를 잡고 그 주소를 stdout 에 찍는가
//   · 둘을 띄우면 포트가 갈리는가 (같으면 프로젝트별 서버라는 전제가 무너진다)
//   · stop() 뒤에 그 포트가 정말 닫히는가 (안 닫히면 앱을 끌 때마다 서버가 쌓인다)
//
// ⚠️ **이 레포 루트를 cwd 로 주지 말 것.** node_modules 가 700MB 가까워 opencode 가
// 초기 스캔에서 멈춘다 (`live.test.ts` 와 같은 함정). 빈 임시 폴더면 충분하다.

const LIVE = process.env['OPENCODE_LIVE'] === '1'

const emptyProject = (): string => mkdtempSync(join(tmpdir(), 'oc-spawn-'))

describe.skipIf(!LIVE)('live opencode serve', () => {
  it('띄우면 주소를 알리고, 둘을 띄우면 포트가 갈리고, 끄면 닫힌다', async () => {
    const lookup = findOpencodeBinary()
    expect(lookup.path, notFoundMessage(lookup)).not.toBeNull()
    const binPath = lookup.path!

    const a = await startOpencodeServer({ binPath, cwd: emptyProject() })
    const b = await startOpencodeServer({ binPath, cwd: emptyProject() })
    try {
      // 우리가 포트를 고르지 않았는데도 갈렸다 = `--port` 없이 띄우는 전제가 산다
      expect(a.url).not.toBe(b.url)

      const config = await fetch(`${a.url}/config`)
      expect(config.status).toBe(200)
    } finally {
      await a.stop()
      await b.stop()
    }

    // 껐으면 포트가 반납돼야 한다. 살아 있으면 여기서 200 이 온다.
    await new Promise((done) => setTimeout(done, 500))
    await expect(fetch(`${a.url}/config`)).rejects.toThrow()
  }, 90_000)
})
