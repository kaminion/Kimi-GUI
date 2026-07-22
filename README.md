# Kimi Desktop

[Kimi Code CLI](https://www.kimi.com)의 로컬 서버(`kimi web`) 위에 구축한 데스크톱 GUI입니다. Apple Human Interface Guidelines 기반의 블랙 프리미엄 테마(다크 기본, 라이트 옵션)를 적용했고, macOS와 Windows를 지원합니다. Electron + 순수 JavaScript(ES2022)로 작성했으며 번들러를 사용하지 않습니다.

## 주요 기능

- **첫 실행 스플래시·온볼링** — CLI 자동 설치(macOS: `install.sh`, Windows: `install.ps1`)와 브라우저 로그인(device flow)을 앱 안에서 처리하므로, CLI가 설치되어 있지 않아도 앱만으로 시작할 수 있습니다.
- **스트리밍 대화** — Claude Code 스타일의 전체 폭 트랜스크립트, 마크다운 렌더링, 실시간 스트리밍 응답, 중단(abort) 지원.
- **도구 승인 모달** — CLI가 요청하는 도구 실행 승인/거절을 모달로 처리합니다.
- **프로젝트별 세션 그룹핑** — 사이드바가 세션을 작업 디렉터리(cwd) 기준 프로젝트별로 그룹핑해 표시합니다.
- **대화 내용 검색** — ⌘F(Windows: Ctrl+F)로 전체 세션의 메시지를 검색하고, 결과를 클릭하면 해당 메시지 위치로 이동합니다.
- **에이전트 작업 패널** — 우측 패널에서 현재 실행 상태, 작업 목록, 최근 도구 활동, 변경된 파일을 실시간으로 확인합니다.
- **채팅 옵션** — 채팅 헤더에서 세션별 모델 선택과 Swarm 모드 토글을 제공합니다.
- **설정** — 언어(한국어/English), 테마(시스템/다크/라이트), 기본 모델, 계정(로그인 상태·재로그인), 업데이트 확인, 앱/CLI 정보를 관리합니다.
- **사용량 화면** — 계정 주간/5시간 롤링 쿼터와 세션별 토큰 사용량·컨텍스트 윈도우 점유율을 표시합니다.
- **자동 업데이트** — GitHub Releases 기반(electron-updater). 실행 시 무음 검사 1회 + 설정에서 수동 확인이 가능합니다.

## 요구사항

- macOS 또는 Windows
- Node.js 20 이상 (개발/실행 환경)
- 인터넷 연결 (CLI 설치, 로그인, 모델 응답에 필요)
- Kimi Code CLI는 앱이 첫 실행 시 자동으로 설치합니다. 수동 설치된 CLI가 있으면 그것을 사용합니다(`KIMI_CLI_PATH` 환경 변수 → `PATH`의 `kimi` → 기본 설치 경로 순으로 탐색).

## 실행

```bash
npm install
npm start
```

## 빌드

```bash
npm run dist
```

빌드 산출물은 `dist/`에 생성됩니다.

| 플랫폼 | 타깃 | 비고 |
| --- | --- | --- |
| macOS | DMG + ZIP | `npm run dist -- --mac --arm64 --x64`로 두 아키텍처 빌드. 자동 업데이트에는 ZIP이 필요 |
| Windows | NSIS 설치 프로그램 + 포터블 | macOS에서 크로스 빌드 가능: `npm run dist -- --win`(Wine이 필요할 수 있음). NSIS만 자동 업데이트 지원 |

배포 설정은 개발용으로 서명/공증을 비활성화한 상태(`hardenedRuntime: false`)이며, 빌드한 앱 실행 시 macOS Gatekeeper 경고가 표시될 수 있습니다.

## 아키텍처

앱을 실행하면 main 프로세스가 로컬에 설치된 Kimi Code CLI를 찾아 `kimi web --no-open --port <포트>`로 로컬 REST + WebSocket 서버를 spawn합니다. 서버 stdout 배너(`Local: http://127.0.0.1:<포트>/#token=<토큰>`)에서 URL과 인증 토큰을 파싱해 이후 모든 통신에 사용합니다. 토큰은 로컬 서버와의 통신에만 쓰이며 외부로 전송되지 않습니다.

- **REST** — `<url>/api/v1`, `Authorization: Bearer <토큰>` 헤더. 세션·메시지·승인·프로필 등 요청-응답 처리.
- **WebSocket** — `/api/v1/ws`, subprotocol(`kimi-code.bearer.<토큰>`) 인증. 스트리밍 델타, 도구 호출, 승인 요청, 사용량 갱신 등 서버 푸시 이벤트 수신.
- **브리지** — preload 스크립트가 `contextBridge`로 `window.kimi` API만 노출합니다. renderer는 contextIsolation이 켜진 채 nodeIntegration 없이 동작합니다.

프로토콜 상세(검증된 엔드포인트·이벤트 시퀀스)는 `docs/protocol.md`를 참고하세요.

## 파일 트리

```
├── package.json             # 앱 메타데이터, 실행/빌드 스크립트
├── electron-builder.yml     # 패키징 설정 (mac dmg/zip, win nsis/portable)
├── main/                    # Electron main 프로세스 (CommonJS)
│   ├── main.js              # 진입점: 윈도우 생성, 라이프사이클
│   ├── server-manager.js    # kimi web 서버 spawn/관리
│   ├── kimi-client.js       # REST + WebSocket 클라이언트
│   ├── ipc.js               # ipcMain 핸들러 (kimi:* 채널)
│   ├── preload.js           # contextBridge → window.kimi
│   ├── onboarding.js        # CLI 자동 설치 + 로그인 (device flow)
│   ├── search.js            # 세션 트랜스크립트 전문 검색
│   ├── updater.js           # 자동 업데이트 (electron-updater)
│   └── quota.js             # 계정 할당량 조회 (best-effort)
├── renderer/                # UI (ES modules, script 태그 로드)
│   ├── index.html
│   ├── styles/              # Apple HIG 기반 CSS (블랙 프리미엄 다크 테마)
│   └── js/                  # app, sidebar, chat, markdown, approvals, usage,
│                            #   onboarding, search, panel, settings, chat-options, i18n
├── vendor/                  # marked, highlight.js 등 번들 라이브러리
├── assets/                  # 앱 아이콘 등 리소스
└── docs/
    ├── protocol.md          # kimi web 프로토콜 검증 노트
    ├── quota.md             # 계정 쿼터 API 노트
    ├── update.md            # 자동 업데이트 동작/배포 문서
    ├── design.md            # 디자인 시스템
    ├── CONTRACT-V2.md       # v2 기능 계약
    └── ref/                 # openapi.json, asyncapi.json, webui-bundle.js 레퍼런스
```

## 업데이트 배포

자동 업데이트는 GitHub Releases(`kaminion/kimi-gui`)를 피드로 사용합니다. 릴리스하려면 `package.json`의 `version`을 올린 뒤 `GH_TOKEN` 환경 변수와 함께 `npm run dist -- --publish always`를 실행하면 electron-builder가 아티팩트와 업데이트 메타데이터(`latest-mac.yml`, `latest.yml`)를 Release에 업로드합니다. 공개 리포지토리이므로 클라이언트 측 확인/다운로드에는 토큰이 필요 없습니다. 상세 절차와 제약은 `docs/update.md`를 참고하세요.

## 알려진 제한

- **과거 세션의 토큰 수치가 0으로 표시됩니다.** kimi 0.28.1 데몬은 세션 토큰 집계를 REST(`GET /sessions/{id}`의 `usage` 등)로 제공하지 않아 재시작 후 로드한 세션의 토큰 수치는 0으로 보이며, 실시간 이벤트(WebSocket)로 수신하는 동안에만 갱신됩니다.
- **Windows 인스톨러 경로는 미검증 상태입니다.** NSIS/포터블 빌드와 Windows용 CLI 자동 설치(`install.ps1`) 경로는 실제 Windows 환경에서 검증되지 않았습니다.
- **미서명 개발 빌드에서는 자동 업데이트 설치가 실패할 수 있습니다.** macOS의 자동 업데이트 설치 단계는 코드 서명 검증을 요구하므로, 실제 배포 시 Apple Developer ID 서명 + 공증이 필요합니다.
- **앱을 종료하면 앱이 띄운 로컬 `kimi web` 서버도 함께 종료됩니다.** 진행 중인 작업이 있다면 종료 전에 완료 여부를 확인하세요.
