import { cp, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExtensionUiServer, uiPolicy } from './uiServer'

// 웹뷰 앞단 서빙의 **울타리** — 토큰이 묶은 `ui/` 밖으로는 한 바이트도 안 나간다 (E2).
//
// 실제 스킴 스택(Electron 의 URL 정규화 + CSP)은 vitest 로 못 본다. 그쪽은 2026-09-22 에 실 Electron
// 33.4.11 로 쟀다 (`viewProtocol.ts` 머리말) — 여기는 처리기 자체가 무엇을 내주나를 잠근다.
// Electron 이 `..` 를 접어 주는 것에 기대지 않는다: 그 층이 빠져도 이 처리기가 막아야 한다.

const FIXTURE = join(__dirname, '../../tests/extensions/webview-v3')

let root = ''
let extensionDir = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ui-server-'))
  extensionDir = join(root, 'webview-v3')
  await cp(FIXTURE, extensionDir, { recursive: true })
  // `ui/` 바로 밖의 비밀 — 이것이 새면 울타리가 없다
  await writeFile(join(extensionDir, 'secret.txt'), 'SECRET')
  await writeFile(join(root, 'outside.txt'), 'OUTSIDE')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 토큰을 셈으로 낸다 — 시험에서 URL 을 적을 수 있게 */
function counting(): ExtensionUiServer {
  let next = 0
  return new ExtensionUiServer(() => `t${(next += 1)}`)
}

async function opened(server: ExtensionUiServer, projectId = 'P') {
  const result = await server.open({ extension: 'webview-fixture', viewId: 'board', projectId, extensionDir, entry: 'ui/index.html' })
  if (!result.ok) throw new Error(result.reason)
  return result
}

const text = (body: Uint8Array | string) => (typeof body === 'string' ? body : Buffer.from(body).toString('utf8'))

describe('토큰 하나 = (확장 ui/ · 프로젝트 · 뷰)', () => {
  it('문서 URL 을 내준다 — 경로는 ui/ 기준이다', async () => {
    const server = counting()
    expect((await opened(server)).url).toBe('code-ext://ui/t1/index.html')
  })

  it('ui/ 안의 파일을 content-type 과 CSP 헤더를 붙여 내준다', async () => {
    const server = counting()
    await opened(server)

    const html = await server.handle('code-ext://ui/t1/index.html')
    const script = await server.handle('code-ext://ui/t1/sub/app.js')

    expect(html.status).toBe(200)
    expect(html.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(script.headers['content-type']).toBe('text/javascript; charset=utf-8')
    // CSP 는 문서가 아니라 **헤더**로 간다 — 문서는 확장 것이라 앱이 끼울 자리가 없다
    expect(html.headers['content-security-policy']).toBe(uiPolicy('t1'))
  })

  it('CSP 는 바깥 네트워크를 막고, 싣기는 **그 토큰 경로**에서만 허용한다', () => {
    const policy = uiPolicy('t1')
    expect(policy).toContain("connect-src 'none'")
    expect(policy).toContain("default-src 'none'")
    expect(policy).toContain('script-src code-ext://ui/t1/ ')
    // `'self'` 는 `code-ext://ui` 전체라 남의 탭 토큰까지 연다
    expect(policy).not.toContain("'self'")
    expect(policy).not.toMatch(/https?:/)
    // 인라인 스크립트는 안 연다
    expect(policy).not.toContain("'unsafe-inline'")
  })

  it('같은 탭은 다시 열지 않는 한 토큰이 그대로다 — 파일을 몇 번 받아도', async () => {
    const server = counting()
    await opened(server)
    await server.handle('code-ext://ui/t1/index.html')
    await server.handle('code-ext://ui/t1/style.css')
    expect(server.binding('t1')).toMatchObject({ extension: 'webview-fixture', viewId: 'board', projectId: 'P' })
    expect(server.tokensOf('webview-fixture', 'board', 'P')).toEqual(['t1'])
  })

  it('행선지는 프로젝트까지 맞아야 한다 — P 의 탭과 Q 의 탭은 다른 토큰이다', async () => {
    const server = counting()
    await opened(server, 'P')
    await opened(server, 'Q')
    expect(server.tokensOf('webview-fixture', 'board', 'P')).toEqual(['t1'])
    expect(server.tokensOf('webview-fixture', 'board', 'Q')).toEqual(['t2'])
  })
})

describe('ui/ 밖은 404', () => {
  const escapes = [
    'code-ext://ui/t1/../secret.txt',
    'code-ext://ui/t1/%2e%2e/secret.txt',
    'code-ext://ui/t1/..%2Fsecret.txt',
    'code-ext://ui/t1/..%5Csecret.txt',
    'code-ext://ui/t1/sub/%2e%2e/%2e%2e/secret.txt',
    'code-ext://ui/t1/%2e%2e/%2e%2e/outside.txt',
    'code-ext://ui/t1/',
    'code-ext://ui/t1/sub',
    'code-ext://ui/t1/nope.js',
    'code-ext://view/t1/index.html',
  ]
  for (const url of escapes) {
    it(`${url.replace('code-ext://ui/t1', '')} → 404`, async () => {
      const server = counting()
      await opened(server)
      const served = await server.handle(url)
      expect(served.status).toBe(404)
      expect(text(served.body)).not.toContain('SECRET')
      expect(text(served.body)).not.toContain('OUTSIDE')
    })
  }

  it('ui/ 안의 심링크가 밖을 가리키면 404', async () => {
    await symlink(join(extensionDir, 'secret.txt'), join(extensionDir, 'ui', 'link.txt'))
    const server = counting()
    await opened(server)
    expect((await server.handle('code-ext://ui/t1/link.txt')).status).toBe(404)
  })

  it('모르는 토큰·놓은 토큰은 404', async () => {
    const server = counting()
    await opened(server)
    expect((await server.handle('code-ext://ui/t9/index.html')).status).toBe(404)
    server.release('t1')
    expect((await server.handle('code-ext://ui/t1/index.html')).status).toBe(404)
  })

  it('문서 자리가 ui/ 밖이거나 없으면 토큰을 내지 않는다', async () => {
    const server = counting()
    const outside = await server.open({ extension: 'x', viewId: 'v', projectId: 'P', extensionDir, entry: 'ui/../secret.txt' })
    const missing = await server.open({ extension: 'x', viewId: 'v', projectId: 'P', extensionDir, entry: 'ui/none.html' })
    expect(outside.ok).toBe(false)
    expect(missing.ok).toBe(false)
    expect(server.tokensOf('x', 'v', 'P')).toEqual([])
  })
})
