// 원격 전송의 **갈아끼우는 자리** (계획 §5·§12 #6).
//
// 선례는 `electron/ws/transport.ts` 의 `Transport` 다 — 위층(`electron/session/*`)이 전송 수단을
// 모르는 덕에 davis WS 를 opencode HTTP+SSE 로 갈아끼울 때 세션 계층을 한 줄도 안 고쳤다
// (`desktop/CLAUDE.md` 설계 §10 DIP). 여기서도 전송별로 다른 것은 **이 인터페이스 하나**이고
// 조각(`framing.ts`)·투영(`projection.ts`)·프레임(`frames.ts`)은 공유한다.
//
// **추측성 추상이 아니다** — 후보가 실제로 둘이다 (계획 §5): BLE GATT(`@stoprocent/bleno`,
// P0 측정으로 맥에서 뜨는 것을 확인 — 계획 §13)와 같은 망 LAN. 사용자 결정은 「일단 BLE 만,
// LAN 은 고민 중」(§12 #6)이라 LAN 을 지금 만들지는 않는다.
//
// ## 이번 회차에 프로덕션 구현이 없다
//
// P1 의 앞쪽은 **전송 없이** 짠다 (bleno 는 이 레포의 첫 네이티브 모듈이라 CI·패키징 영향을
// 따로 본다). 그래서 `RemoteService.attach()` 를 부르는 프로덕션 호출자가 아직 없고, 지금
// 이 인터페이스를 구현하는 것은 시험의 `tests/remote/MemoryLink.ts` 뿐이다.
//
// ⚠️ **전송을 붙이기 전에 §3(페어링·암호)이 먼저 와야 한다.** 지금 링크에 흐르는 것은 앱 프레임
// **평문**이다 (`PROTOCOL.md` §3-4 의 `0x10`+카운터+AEAD 겉봉이 아직 없다). 보기만 해도 코드가
// PC 밖으로 나가므로 보안은 P1 부터라는 것이 계획 §9 의 판정이다.

export interface RemoteLink {
  /**
   * 지금 쓸 수 있는 조각 크기 = 협상된 ATT MTU − 3 (`PROTOCOL.md` §1).
   *
   * **값이 아니라 게터다** — 휴대폰이 연결 직후 MTU 를 올려 달라고 하므로(Android
   * `requestMtu(517)`) 연결 중에 커진다. 협상 전에는 20 이다.
   */
  readonly fragmentBytes: number

  /** 조각 하나를 상대에게. 링크가 이미 끊겼으면 조용히 버린다 (§2: 링크 층은 재전송하지 않는다) */
  send(fragment: Uint8Array): void

  /** 조각이 왔다. 구독은 링크 하나에 하나뿐이다 — 원격 연결은 한 번에 하나다 (§1) */
  onFragment(listener: (fragment: Uint8Array) => void): void

  /** 상대가 끊겼다(또는 우리가 끊었다) */
  onClose(listener: () => void): void

  close(): void
}
