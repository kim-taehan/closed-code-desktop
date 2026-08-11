import { describe, expect, it } from 'vitest'
import { ExtensionViewHost, VIEW_SCHEME } from './viewHost'

// 확장 화면을 URL 로 내주는 곳.
//
// 이것이 생긴 이유는 하나다 — `srcdoc` 문서가 **앱 CSP 를 물려받아** 확장 화면의 스크립트가
// 통째로 죽었다 (`viewHost.ts` 머리말의 실측). 그래서 여기서 보는 것은 "서빙되는가" 가 아니라
// **그 사고가 되돌아오지 않는가** 다: 매번 새 URL 인가, 모르는 토큰이 빈 화면이 아닌가.

describe('확장 화면 서빙', () => {
  it('등록한 문서를 그 URL 로 돌려준다', () => {
    const host = new ExtensionViewHost()

    const url = host.register('<p>안녕</p>')

    expect(url.startsWith(`${VIEW_SCHEME}://view/`)).toBe(true)
    expect(host.handle(url)).toEqual({ status: 200, body: '<p>안녕</p>' })
  })

  it('부를 때마다 다른 URL 이다 — 같은 URL 이면 브라우저가 옛 화면을 그대로 보여준다', () => {
    // 명령을 다시 돌렸는데 화면이 안 바뀌면 사용자에게는 "안 먹었다" 로 보인다.
    const host = new ExtensionViewHost()

    const first = host.register('<p>1회</p>')
    const second = host.register('<p>2회</p>')

    expect(first).not.toBe(second)
    expect(host.handle(second).body).toBe('<p>2회</p>')
  })

  it('모르는 토큰은 빈 200 이 아니라 404 로 사유를 남긴다', () => {
    // 빈 200 을 주면 화면이 하얗게만 뜨고, 만료된 것인지 배선이 끊긴 것인지 구분되지 않는다.
    const host = new ExtensionViewHost()

    const served = host.handle(`${VIEW_SCHEME}://view/없는것`)

    expect(served.status).toBe(404)
    expect(served.body).toContain('만료된')
  })

  it('모양이 아닌 주소도 404 다 — 던지지 않는다', () => {
    // protocol.handle 안에서 던지면 프레임이 통째로 안 뜨고 사유도 안 남는다.
    const host = new ExtensionViewHost()

    expect(host.handle('davis-ext://딴데').status).toBe(404)
    expect(host.handle('http://example.com/view/1').status).toBe(404)
  })

  it('오래된 문서는 버린다 — 훑을 때마다 수백 KB 가 쌓이면 안 된다', () => {
    const host = new ExtensionViewHost()
    const first = host.register('<p>맨 처음</p>')

    // 상한(16)을 확실히 넘긴다
    for (let index = 0; index < 20; index += 1) host.register(`<p>${index}</p>`)

    expect(host.handle(first).status).toBe(404)
    // 그래도 최근 것은 살아 있다
    expect(host.handle(host.register('<p>최근</p>')).body).toBe('<p>최근</p>')
  })

  it('정리하면 전부 사라진다', () => {
    const host = new ExtensionViewHost()
    const url = host.register('<p>x</p>')

    host.dispose()

    expect(host.handle(url).status).toBe(404)
  })
})
