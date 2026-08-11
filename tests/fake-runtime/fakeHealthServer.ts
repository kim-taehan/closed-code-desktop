import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

// 가짜 runtime 의 HTTP 면.
//
// RuntimeManager 는 WebSocket 에 붙기 전에 /health 를 확인한다.
// WS 만 열어두면 탐색 단계에서 막혀 세션이 시작조차 하지 않는다 —
// 하네스가 실제와 어긋나면 통과해도 의미가 없다.

/** 실제 runtime 의 /health 응답에서 판정에 쓰이는 부분만 흉내낸다 */
const HEALTHY_BODY = JSON.stringify({
  status: 'healthy',
  service: 'DAVIS Code Runtime (fake)',
  init: { chat_ready: true },
})

export async function startHealthServer(host = '127.0.0.1'): Promise<{ server: Server; port: number }> {
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/health')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(HEALTHY_BODY)
      return
    }
    response.writeHead(404)
    response.end()
  })

  await new Promise<void>((resolve) => server.listen(0, host, resolve))
  return { server, port: (server.address() as AddressInfo).port }
}

export async function stopHealthServer(server: Server | null): Promise<void> {
  if (!server) return
  await new Promise<void>((resolve) => server.close(() => resolve()))
}
