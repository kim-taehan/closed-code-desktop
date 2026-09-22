// mac 산출물에 **ad-hoc 코드 서명**을 넣는다 (davis-code-desktop `ac7f596` 에서 가져왔다).
//
// **왜 필요한가.** Apple Silicon 은 실행 파일에 최소한의 서명이 있기를 요구한다. 서명이 아예
// 없는 앱이 브라우저 다운로드 꼬리표(`com.apple.quarantine`)를 달고 오면 macOS 는
// 「확인되지 않은 개발자」가 아니라 **「손상되었기 때문에 열 수 없습니다」** 로 판정하고,
// 그 창에는 여는 선택지가 없다 — 휴지통으로 옮기기뿐이다 (공여 쪽 실측 2026-09-16, Chrome 으로 받은
// 3.5.1 arm64 빌드).
//
// 정확히는 서명이 **없는** 것이 아니라 **깨진** 것이다. electron 바이너리에 붙어 온 linker-signed
// ad-hoc 서명을 electron-builder 가 번들을 다시 조립한 뒤 다시 걸지 않는다. 이 레포의 산출물도
// 같다 (2026-09-22 `release/mac-arm64/*.app` 에 `codesign --verify --strict`:
// "code has no resources but signature indicates they must be present").
//
// ad-hoc 서명(`codesign --sign -`)은 **신원을 증명하지 않는다.** 누가 만들었는지는 여전히
// 알 수 없고 공증(notarization)도 아니다. 다만 "서명이 통째로 없다"는 상태를 벗어나므로
// 판정이 「손상됨」에서 「확인되지 않은 개발자」로 바뀌고, 사용자가 시스템 설정 →
// 개인정보 보호 및 보안에서 「그래도 열기」로 통과할 수 있다.
//
// **OS 보안 검사를 끄지 않는다**. 꼬리표를 벗기거나 Gatekeeper 를 손대는 것이
// 아니라, 우리 쪽 산출물이 검사를 받을 수 있는 최소 형태를 갖추는 것이다. 경고 없이 열리게
// 하려면 Developer ID 인증서와 공증이 필요하며 그것은 별건이다.
//
// electron-builder 의 `mac.identity: null` 은 서명 단계를 통째로 건너뛰므로(빌드 로그:
// "skipped macOS code signing  reason=identity explicitly is set to null") 여기서 직접 건다.
// 순서상 afterPack 은 .app 이 완성된 뒤·압축 전이라 서명이 배포물에 그대로 들어간다.
//
// ⚠️ **동봉한 opencode(`Contents/Resources/opencode/opencode`)는 따로 서명하지 않는다.** `--deep` 은
// Frameworks·MacOS 같은 코드 자리만 내려가고, Resources 아래 실행 파일은 리소스로 봉인할 뿐이다.
// 그 바이너리는 받아 온 그대로도 `codesign --verify` 가 "invalid signature" 로 답하지만 로컬에서는
// 뜬다 (2026-09-22, mac-arm64 `--version` → 1.18.18). 브라우저로 받은 zip 에서도 뜨는지는 아직 안 쟀다.

const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  // --deep 은 애플이 서명 배포용으로는 권장하지 않지만, 번들 안의 헬퍼·프레임워크까지
  // 한 번에 ad-hoc 으로 채우는 용도로는 이것이 가장 단순하다. 하나라도 빠지면 그 바이너리
  // 때문에 같은 「손상됨」 판정이 되살아난다.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
  // 서명이 실제로 붙었는지 여기서 확인한다 — 빠진 채 배포되면 사용자 화면에서야 드러난다.
  execFileSync('codesign', ['--verify', '--strict', app], { stdio: 'inherit' })
  console.log(`  • ad-hoc 서명 완료  ${app}`)
}
