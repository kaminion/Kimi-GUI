# Kimi Desktop

로컬에 설치된 [Kimi Code CLI](https://www.kimi.com)(`kimi`)를 Apple Human Interface Guidelines 기반의 네이티브 스타일 GUI로 감싼 데스크톱 앱입니다. macOS와 Windows를 지원합니다.

주요 기능:

- 대화형 채팅 — Claude Code 스타일의 트랜스크립트, 마크다운 렌더링, 스트리밍 응답
- 세션 관리 — 사이드바에서 세션 생성/전환, 작업 디렉터리 지정
- 도구 승인 — CLI가 요청하는 도구 실행 승인/거절을 모달로 처리
- 사용량 확인 — 세션별 토큰 사용량 및 계정 할당량 조회

## 요구사항

- **Kimi Code CLI** 설치 및 로그인 완료 상태 (`kimi` v0.28.1 이상, 기본 경로 `~/.kimi-code/bin/kimi`)
  - CLI를 찾는 순서: `KIMI_CLI_PATH` 환경 변수 → `PATH`의 `kimi` → 기본 설치 경로
- **Node.js 20 이상** (개발/실행 환경)
- macOS 또는 Windows

## 실행 방법

```bash
npm install
npm start
```

## 빌드 방법

```bash
npm run dist
```

빌드 산출물은 `dist/`에 생성되며, 파일 이름에 아키텍처(`${arch}`)가 포함됩니다.

- **macOS**: DMG + ZIP. Apple Silicon(arm64)과 Intel(x64) 두 아키텍처 모두 빌드하려면 `npm run dist -- --mac --arm64 --x64`를 실행하세요.
- **Windows**: NSIS 설치 프로그램 + 포터블 실행 파일.
  - Windows 설치 파일은 macOS에서도 크로스 빌드할 수 있습니다 (`npm run dist -- --win`). 별도 서명을 설정하지 않은 개발 빌드 기준이며, 환경에 따라 실행 파일 리소스 편집 단계에서 Wine이 필요할 수 있습니다.

## 아키텍처

앱을 실행하면 main 프로세스가 로컬에 설치된 Kimi Code CLI를 찾아 `kimi web --no-open --port <포트>`로 로컬 REST + WebSocket 서버를 spawn합니다. 서버 stdout 배너(`Kimi server: http://127.0.0.1:<포트>/#token=<토큰>`)에서 URL과 인증 토큰을 파싱해 이후 모든 통신에 사용합니다. 토큰은 로컬 서버와의 통신에만 쓰이며 외부로 전송되지 않습니다.

main 프로세스의 클라이언트는 REST(`/api/v1`, Bearer 토큰 인증)로 세션·메시지·승인 등의 요청-응답을 처리하고, WebSocket(`/api/v1/ws`)으로 스트리밍 응답, 도구 호출, 승인 요청 같은 서버 푸시 이벤트를 수신합니다. preload 스크립트가 `contextBridge`를 통해 `window.kimi` API만 노출하므로 renderer는 nodeIntegration 없이 격리된 상태로 동작하며, 이 API를 통해 채팅 UI(트랜스크립트, 세션 사이드바, 승인 다이얼로그, 사용량 뷰)를 렌더링합니다.

UI는 Electron + 순수 JavaScript(ES2022)로 작성되며 번들러를 사용하지 않습니다. 마크다운 렌더링과 코드 하이라이팅은 `vendor/`의 marked와 highlight.js가 담당하고, 모든 사용자 대면 문구는 한국어입니다.

```
├── package.json             # 앱 메타데이터, 실행/빌드 스크립트
├── electron-builder.yml     # 패키징 설정 (mac dmg/zip, win nsis/portable)
├── main/                    # Electron main 프로세스 (CommonJS)
│   ├── main.js              # 진입점: 윈도우 생성, 라이프사이클
│   ├── server-manager.js    # kimi web 서버 spawn/관리
│   ├── kimi-client.js       # REST + WebSocket 클라이언트
│   ├── ipc.js               # ipcMain 핸들러 (kimi:* 채널)
│   ├── preload.js           # contextBridge → window.kimi
│   └── quota.js             # 계정 할당량 조회 (best-effort)
├── renderer/                # UI (ES modules, script 태그 로드)
│   ├── index.html
│   ├── styles/              # Apple HIG 기반 CSS
│   └── js/                  # app, sidebar, chat, markdown, approvals, usage
├── vendor/                  # marked, highlight.js 등 번들 라이브러리
├── assets/                  # 앱 아이콘 등 리소스
└── docs/
    ├── protocol.md, quota.md, design.md
    └── ref/                 # openapi.json, asyncapi.json 등 레퍼런스
```

## 주의사항

- **앱을 종료하면 앱이 띄운 로컬 `kimi web` 서버도 함께 종료됩니다.** 진행 중이던 작업이 있다면 앱 종료 전에 완료 여부를 확인하세요.
- **사용량(할당량) 표시는 계정 API가 제공하는 범위에 따릅니다.** 계정 할당량을 조회할 수 없는 환경에서는 세션별 사용량만 표시됩니다.
- 배포 설정은 개발용으로 서명/공증을 비활성화한 상태(`hardenedRuntime: false`)입니다. 빌드한 앱 실행 시 macOS Gatekeeper 경고가 표시될 수 있습니다.
