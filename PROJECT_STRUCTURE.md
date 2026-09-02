# davis-code-desktop 프로젝트 구조 분석

## 1. 프로젝트 개요

### 주요 목적과 기능
**Closed Code Desktop**은 `davis-code-runtime` 에 WebSocket 으로 연결되는 데스크톱 클라이언트로, IDE 플러그인 없이 독립 실행하는 AI 코딩 어시스턴트입니다. 엔터프라이즈 및 에어갭 (외부 네트워크 차단) 환경을 대상으로 합니다.

**주요 기능:**
- **채팅 인터페이스**: 런타임 (에이전트) 과 대화하며 코드 생성/수정, 스트리밍 응답, 도구 실행 승인, 플랜 모드 지원
- **프로젝트 관리**: 여러 프로젝트를 동시 열고 각자 독립된 세션 유지 (탭 전환 시 대화 보존)
- **소스 관리**: Git 연동 (브랜치 조회, diff, 스테이지/커밋/푸시)
- **런타임 수명 관리**: 런타임 자동 탐색, 다운로드, 설치, 업데이트, 설치
- **입력 히스토리**: 프로젝트별 입력 기록 저장 및 ↑/↓로 되짚기

### 기술 스택
- **프레임워크**: Electron 33, React 19
- **언어**: TypeScript 5
- **빌드 도구**: Vite 6
- **테스트 프레임워크**: Vitest 2
- **스타일링**: CSS (커스텀)
- **통신**: WebSocket (런타임 연결), IPC (메인-렌더러 간 통신)

### 빌드 시스템 및 개발 환경
- **빌드 시스템**: Vite (렌더러) + TypeScript (Electron 메인)
- **패키징**: electron-builder (macOS arm64/x64, Windows 지원)
- **개발 환경**: Node.js 3.x 기반, npm 스크립트 활용

---

## 2. 디렉토리 구조

```
davis-code-desktop/
├── electron/              # 메인 프로세스 (Node.js 환경)
│   ├── main.ts           # 앱 진입점 (창 생성, IPC 등록, 런타임 관리)
│   ├── runtime/          # 런타임 탐색·기동·다운로드·설치·업데이트
│   ├── session/          # 프로젝트별 세션 관리 (핸드셰이크·채팅·멀티턴)
│   ├── ipc/              # 렌더러 ↔ 메인 브리지 (프로젝트·Git·로그·설정)
│   ├── projects/         # 프로젝트 저장소 및 관리
│   ├── git/              # Git 연동 (상태·diff·커밋·푸시)
│   ├── logs/             # 로그 관리 및 저장
│   ├── settings/         # 설정 저장소 (라이선스·포트·자동업데이트)
│   ├── notify/           # 작업 완료 알림
│   ├── ws/               # WebSocket 연결 및 하트비트
│   ├── board/            # 보드 창 관리
│   └── notify/           # 작업 완료 알림
│
├── src/                  # 렌더러 프로세스 (React 환경)
│   ├── components/       # UI 컴포넌트 (80 개 이상)
│   │   ├── ChatComposer.tsx      # 채팅 입력 영역
│   │   ├── MessageList.tsx       # 메시지 목록 렌더링
│   │   ├── FileTree.tsx          # 파일 트리 뷰
│   │   ├── GitPanel.tsx          # Git 상태 패널
│   │   ├── ApprovalModal.tsx     # 도구 실행 승인 모달
│   │   ├── TurnContainer.tsx     # 턴 단위 컨테이너
│   │   ├── FileDiffView.tsx      # 파일 차이 뷰어
│   │   └── ... (80 개 이상)
│   ├── state/            # 상태 관리 훅 (Zustand 패턴)
│   │   ├── useSessionState.ts    # 세션 상태 (메시지·승인·턴)
│   │   ├── useProjects.ts        # 프로젝트 목록 및 활성화
│   │   ├── useGitState.ts        # Git 상태
│   │   ├── useFileTree.ts        # 파일 트리
│   │   ├── useAttachments.ts     # 첨부 파일
│   │   └── ... (30 개 이상)
│   ├── lib/davis-progress/       # 진행 표시 컴포넌트 (DAVIS 브랜드)
│   ├── styles/           # CSS 스타일 파일
│   ├── logs/             # 로그 뷰 컴포넌트
│   ├── utils/            # 유틸리티 함수
│   ├── i18n/             # 국제화 (한국어 지원)
│   └── App.tsx           # 루트 컴포넌트
│
├── shared/               # 메인·렌더러 공용 코드
│   ├── ipc/              # IPC 채널 및 페이로드 타입
│   ├── protocol/         # WebSocket 프로토콜 정의
│   ├── settings/         # 설정 타입
│   ├── projects/         # 프로젝트 타입
│   └── git/              # Git 타입
│
├── tests/                # 통합 테스트
│   ├── smoke/            # 스모크 테스트 (4 개)
│   └── runtime-protocol/ # davis 런타임 프레임 계약의 인메모리 대역 (서버 아님)
│
├── scripts/              # 빌드/개발 스크립트
│   ├── dev.mjs           # 개발 서버 시작 스크립트
│   └── check-file-size.mjs  # 빌드 사이즈 체크
│
├── build/                # 빌드 리소스 (아이콘 등)
├── dist/                 # Vite 빌드 산출물 (렌더러)
├── dist-electron/        # Electron 빌드 산출물 (메인)
└── release/              # electron-builder 패키지 산출물
```

---

## 3. 핵심 모듈/컴포넌트

### Electron 메인 프로세스 핵심

| 파일/모듈 | 역할 |
|-----------|------|
| `electron/main.ts` | 앱 진입점. 창 생성, IPC 브리지 등록, 런타임 생명주기 관리 |
| `electron/runtime/runtimeManager.ts` | 런타임 인스턴스 관리 (탐색·기동·정리) |
| `electron/runtime/runtimeInstaller.ts` | 런타임 다운로드 및 설치 (에어갭 지원) |
| `electron/session/chatSession.ts` | 프로젝트별 채팅 세션 관리 |
| `electron/session/handshake.ts` | WebSocket 핸드셰이크 로직 |
| `electron/ipc/bridge.ts` | IPC 브리지 기본 구현 |
| `electron/projects/projectRegistry.ts` | 열린 프로젝트 등록 및 관리 |
| `electron/git/gitActions.ts` | Git 명령 실행 (diff, commit, push) |
| `electron/ws/connection.ts` | WebSocket 연결 및 재연결 |

### 렌더러 프로세스 핵심 컴포넌트

| 컴포넌트 | 역할 |
|----------|------|
| `App.tsx` | 루트 컴포넌트. 전체 레이아웃 조립 |
| `ChatComposer.tsx` | 채팅 입력 영역 (첨부파일, 슬래시 명령) |
| `MessageList.tsx` | 메시지 스트리밍 및 렌더링 |
| `TurnContainer.tsx` | 턴 단위 컨테이너 (도구 호출, 승인, 리뷰) |
| `FileDiffView.tsx` | 파일 차이 시각화 |
| `GitPanel.tsx` | Git 상태 표시 및 조작 |
| `FileTree.tsx` | 프로젝트 파일 트리 탐색 |
| `ApprovalModal.tsx` | 도구 실행 승인 다이얼로그 |
| `SettingsDialog.tsx` | 설정 관리 (라이선스, 포트, MCP) |
| `ConnectionTest.tsx` | 런타임 연결 진단 |

### 상태 관리 훅

| 훅 | 역할 |
|----|------|
| `useSessionState` | 세션 상태 (메시지, 턴, 승인, 계획) |
| `useProjects` | 프로젝트 목록, 활성화, 관리 |
| `useGitState` | Git 상태 (브랜치, 변경사항) |
| `useFileTree` | 파일 트리 데이터 |
| `useAttachments` | 첨부 파일 관리 |
| `useToasts` | 토스트 알림 관리 |
| `useSidebarWidth` | 사이드바 너비 조절 |

---

## 4. 의존성 관리

### 주요 의존성 (package.json 기준)

**런타임 의존성:**
```json
{
  "react": "^19.0.0",
  "react-dom": "^19.0.0",
  "react-markdown": "^10.1.0",
  "rehype-highlight": "^7.0.2",
  "remark-breaks": "^4.0.0",
  "remark-gfm": "^4.0.1",
  "ws": "^8.18.0"
}
```

**개발 의존성:**
```json
{
  "@testing-library/react": "^16.3.2",
  "@vitejs/plugin-react": "^4.3.4",
  "electron": "^33.2.0",
  "electron-builder": "^25.1.8",
  "typescript": "^5.7.2",
  "vite": "^6.0.3",
  "vitest": "^2.1.8",
  "jsdom": "^29.1.1"
}
```

---

## 5. 실행 및 테스트 방식

### 개발 환경 실행

```bash
# 의존성 설치
npm install

# 개발 모드 (Vite dev 서버 + Electron)
npm run dev

# 타입 체크
npm run typecheck

# 테스트 실행
npm test              # vitest run (한 번 실행)
npm run test:watch    # vitest watch (모니터링 모드)
npm run coverage      # 커버리지 리포트
```

### 프로덕션 빌드

```bash
# 전체 빌드 (타입체크 → 렌더러 → Electron)
npm run build

# 빌드된 앱 실행
npm start

# macOS 패키징 (arm64 + x64)
npm run dist:mac

# Windows 패키징
npm run dist:win
```

### 테스트 구조

| 테스트 유형 | 위치 | 개수 |
|------------|------|------|
| 컴포넌트 테스트 | `src/components/*.test.tsx` | 30 개 이상 |
| 상태 관리 테스트 | `src/state/*.test.ts(x)` | 30 개 이상 |
| Electron 테스트 | `electron/**/*.test.ts` | 35 개 이상 |
| 공유 코드 테스트 | `shared/**/*.test.ts` | 10 개 이상 |
| 통합 테스트 | `tests/smoke/*.test.ts` | 4 개 |
| **총계** | | **110 개 이상** |

---

## 6. 아키텍처 특징

### 프로세스 분리 설계
- **메인 프로세스**: WebSocket 연결, 런타임 생명주기, Git 연산, IPC 처리
- **렌더러 프로세스**: UI 렌더링, 사용자 입력
- **장점**: 화면 새로고침해도 세션 유지, 안정성 향상

### WebSocket 핸드셰이크 순서
```
connect → connected → auth_request → workspace_sync(필수) → chat_request
```

### 프로젝트 중심 설계
- 프로젝트당 독립 세션
- 탭 전환 시 세션 유지
- 프로젝트별 히스토리/설정/파일 트리

### 환경변수 우선 정책
```
DAVIS_RUNTIME_PORT    # 고정 포트 지정
DAVIS_RUNTIME_COMMAND # 런타임 직접 실행 (개발 우회)
DAVIS_LICENSE_KEY     # 라이선스 키
```
환경변수가 설정 화면보다 우선 적용됩니다.

### 에어갭 환경 지원
- 외부 네트워크 의존 최소화
- 런타임 설치는 시스템 `tar` 사용
- 파일에서 직접 설치 가능 (압축 파일 배포)

---

## 7. 요약

**davis-code-desktop**은 Electron 기반의 AI 코딩 어시스턴트 클라이언트로, 다음과 같은 특징을 가집니다:

1. **독립 실행형**: IDE 플러그인 없이 별도 런타임과 WebSocket 으로 통신
2. **프로젝트 중심**: 여러 프로젝트를 탭으로 관리하며 세션 유지
3. **에어갭 대응**: 외부 네트워크 없이도 런타임 설치 및 운영 가능
4. **풍부한 테스트**: 110 개 이상의 테스트 파일로 안정성 보장
5. **현대적 스택**: React 19, TypeScript 5, Vite 6, Electron 33
6. **확장 가능한 아키텍처**: IPC 브리지 패턴으로 메인-렌더러 분리

이 프로젝트는 기업 환경 (특히 보안이 중요한 에어갭 환경) 에서 AI 코딩 도구를 안전하게 사용할 수 있도록 설계되었습니다.
