# 코인 밀집돌파 탐지기

Bybit USDT 무기한 선물의 상승(롱)·하락(숏) 박스 돌파를 검색하는 한국어 모바일 웹 앱. React / TypeScript / Vite로 만든 정적 사이트이며 서버, 로그인, API 키, 자동 주문을 사용하지 않습니다. 모든 조건 수치는 **수익성이 검증되지 않은 실험용 설정**입니다.

## 실행

Node.js 24와 npm 사용:

```sh
npm ci --cache /tmp/coin-npm-cache
npm run dev
npm test
npm run build
npm run preview -- --port 4173
npm run test:browser
```

개발·미리보기 경로는 `/coin-consolidation-breakout/`입니다. 브라우저 테스트에는 Chromium이 필요하며 기본 `/usr/bin/chromium`, 다른 경로는 `CHROMIUM_PATH=/path/to/chromium npm run test:browser`로 지정합니다. 서버가 실행 중이어야 합니다. 다른 테스트 서버는 `TEST_BASE_URL`로 지정할 수 있습니다.

## 검색과 데이터

- V5 `/market/instruments-info`의 `category=linear`, `status=Trading`을 조회하고 `nextPageCursor`가 없을 때까지 페이지네이션합니다. 반복 커서는 오류입니다. `LinearPerpetual`, `quoteCoin=USDT`, `status=Trading`을 모두 만족해야 합니다.
- `/market/tickers`의 **turnover24h ≥ 1,000,000 USDT**인 모든 종목을 검색합니다. 상위 50개 등의 개수 제한은 없습니다. 거래대금이 누락되거나 잘못된 종목은 별도로 실패 처리합니다.
- 유동성은 현재 조회 시점의 스냅샷입니다. 과거 돌파 시점에도 이 유동성을 충족했는지는 검증하지 않습니다. 시각·종목 목록·거래대금 요청은 순차 호출되므로 완전히 원자적인 스냅샷은 아닙니다.
- `/market/time`의 거래소 밀리초 시각을 고정 검색 기준으로 사용합니다. `/market/kline`은 **interval=15만** 요청합니다. 기준 시각에서 이미 마감된 1,000봉(약 10.4일)을 요청하고, 분석 전에도 `startTime + 15분 ≤ 기준 시각`을 확인합니다. 검색 도중 새로 마감된 봉은 다음 검색에서 분석합니다.
- API 응답은 과거→현재로 정렬하며 OHLC, 코인 수량 `volume`, USDT `turnover`, 정렬 경계, 중복·누락, 1,000봉 확보 및 최신 확정봉 존재를 검사합니다. 신규 상장으로 데이터가 부족한 종목은 추정으로 채우지 않습니다.
- 동시 종목 요청 최대 4개, 전체 클라이언트 요청 시작 간격 최소 200ms입니다. 요청당 타임아웃 12초, 최대 3회 시도. 일시적 연결·타임아웃·429·5xx·지정된 일시적 Bybit 오류에만 제한적으로 재시도하며 1초/2초 대기와 `Retry-After`(최대 60초)를 적용합니다. 재시도도 같은 요청 큐를 사용합니다. HTTP 403은 재시도하지 않고 같은 검색의 이후 요청도 중단합니다.
- 일부 실패는 성공 결과와 실패 종목·원인을 함께 표시합니다. 전체 실패·취소는 이전 결과가 있으면 유지하되 **이전 검색 결과**라고 표시합니다. 취소된 검색의 부분 결과를 최종 결과로 섞지 않습니다. 데이터가 없는 초기 실패는 빈 화면과 실제 오류를 표시합니다.
- 접속 시 자동 검색, 이후 수동 `지금 검색`, `검색 취소`. 표시 기간 3/6/24시간(기본 6시간)은 과거 돌파 표시 범위이며 봉 주기 변경이 아닙니다. 주기는 항상 15분입니다. 현재 대기 박스는 표시 기간과 무관하게 별도 표시합니다.
- 모든 화면 시각은 KST, TradingView 링크는 `BYBIT:<symbol>.P`, `interval=15`입니다. 창을 닫으면 검색하지 않습니다. 재접속·브라우저 뒤로가기 복원 시 새 검색을 시작하며 주기적 백그라운드 검색은 없습니다.

## 탐지 규칙과 상태 전이

`src/detection.ts`는 API·UI에 의존하지 않는 순수 함수입니다. `src/api.ts`는 API 요청·파싱, `src/scanner.ts`는 전체 대상 선정·히스토리 검증·진행 집계를 담당합니다.

1. TR은 첫 봉의 고가−저가, 이후 `max(고가−저가, |고가−직전 종가|, |저가−직전 종가|)`입니다. 최초 14개 TR의 평균으로 ATR을 시드하고 이후 `(직전 ATR × 13 + 현재 TR) / 14`의 Wilder 방식으로 계산합니다.
2. 활성 박스가 없으면 해당 시점의 최근 마감 50봉의 최고가·최저가로 박스를 계산합니다. 폭 ≤ 현재 ATR(14) × 3, 첫·마지막 종가 차이 절댓값 ≤ 폭 × 0.3이어야 합니다. ATR은 양수여야 합니다.
3. 확정 시 상단·하단·ATR·50봉 시작 시각·확정 마감 시각을 저장합니다. 이후 경계나 ATR을 수정하지 않습니다. 확정한 같은 봉에서는 돌파를 검사하지 않습니다.
4. 다음 봉부터 1~10번째 마감봉에서 다음 방향별 조건과 공통 조건을 모두 만족하면 신호를 한 번 기록하고 박스를 종료합니다.
   - **상승 돌파(롱)**: 종가 ≥ 고정 상단 + 저장 ATR × 0.1, `(종가−저가)/(고가−저가) ≥ 0.7`
   - **하락 돌파(숏)**: 종가 ≤ 고정 하단 − 저장 ATR × 0.1, `(고가−종가)/(고가−저가) ≥ 0.7` (저가 쪽 30% 안에서 마감)
   - 양쪽 공통: 코인 수량 volume ≥ **돌파봉 직전 50봉** volume 평균 × 2
   - 양쪽 공통: 고가 > 저가, 직전 평균 거래량 > 0
   - 방향은 신호의 `direction: long | short`에 저장하며 화면에 텍스트와 색상으로 구분합니다. 롱은 녹색, 숏은 분홍색입니다. 방향 표시는 매매 진입 추천이 아닙니다.
5. **롱·숏 돌파 확인을 하단 이탈 해제보다 먼저 처리합니다.** 하단 아래 종가가 숏 조건을 충족하면 숏 신호를 확정하며, 조건을 충족하지 못하면 기존처럼 즉시 박스를 해제합니다. 10번째 대기봉까지 돌파가 없으면 만료합니다. 10번째 봉의 유효 롱·숏 돌파는 만료보다 먼저 확정됩니다. 한 박스에서는 양쪽을 합쳐 최초 한 번만 신호를 내며 반대 방향 후속 돌파도 같은 박스의 새 신호로 내지 않습니다.
6. 돌파·하단 이탈·만료 모두 동일한 재탐지 방지 규칙을 적용합니다. **종료봉에서는 새 박스를 만들지 않으며, 새 후보 50봉의 시작이 이전 종료봉보다 뒤여야 합니다.** 따라서 종료 후 최소 50개의 새 마감봉이 모여야 새 박스를 만들 수 있습니다. 이전 박스·대기 구간·종료봉을 재사용하는 겹친 박스를 차단합니다. 가격이 같아도 완전히 새로운 50봉으로 만든 박스는 새 박스입니다. ID는 종목과 박스 확정 마감 시각의 조합입니다.
7. 모든 상태 전이는 시간순으로 진행하며 미래 봉을 보지 않습니다. 매 검색마다 히스토리를 처음부터 재생해 현재 대기와 최근 24시간 신호를 복원하고, 화면은 결과를 교체합니다. 과거 신호와 현재 대기를 합치거나 누적하지 않습니다.

### 복원 범위의 한계

1,000봉의 시작에는 활성 박스·종료 이력이 없는 상태로 시작합니다. ATR도 조회 히스토리에서 시드합니다. 최근 24시간 이전에 900봉 이상의 이전 데이터를 사용하므로 ATR 초기화 영향은 충분히 작지만, 무한 과거부터 계산한 ATR과 수학적으로 동일함을 보장하지 않습니다. 장기간 지속되는 동일 밀집 구간에서는 조회 시작점 이전의 상태를 알 수 없어, 조회 창 이동에 따라 박스 확정 타이밍이 달라질 수 있습니다. 따라서 모든 과거 시점의 영구적·완전한 상태 복원이나 검색 간 영구 신호 보관을 보장하는 앱은 아닙니다. 서버나 영구 히스토리 저장소를 쓰지 않는 첫 버전의 명시적 한계입니다.

## 공식 문서

구현 시 `bybit-exchange/docs` 공식 저장소를 실제 확인했습니다. 참고 프로젝트 `YunSangYeong/bybit-wave-scanner`의 공개 API 큐·재시도와 정적 React 구성 방식을 참고했습니다. 파동 탐지 조건은 재사용하지 않습니다.

- [Kline](https://bybit-exchange.github.io/docs/v5/market/kline): 역시간순 응답, `volume`은 USDT 계약에서 base coin 수량, `turnover`는 USDT 거래대금, 미마감 종가는 마지막 거래가.
- [Instruments](https://bybit-exchange.github.io/docs/v5/market/instrument): cursor 페이지네이션 및 계약 종류.
- [Tickers](https://bybit-exchange.github.io/docs/v5/market/tickers): `turnover24h`.
- [Server time](https://bybit-exchange.github.io/docs/v5/market/time).
- [Rate limits](https://bybit-exchange.github.io/docs/v5/rate-limit): 공식 IP 기본 제한 5초당 600회보다 낮은 요청 속도를 사용합니다. 공유 IP의 다른 사용량까지 보장하지는 않습니다.

## 검증 기록

2026-10-12 클라우드 환경에서:

- 단위 테스트 34개 통과: 50봉 박스·직전 50봉 거래량 평균·돌파봉 제외·ATR/경계 고정·한 박스 한 신호·겹친 구간 재탐지 금지·10봉 만료·하단 이탈·미확정봉 제외·최신봉/누락/부족 검사·Wilder 계산·미래 봉 비참조·숏 임계값/저가 쪽 마감/고정 박스/직전 평균·양방향 합계 한 신호·숏 확정 전 해제 방지·전체 페이지네이션·75종목 전수 검색·거래대금 임계값·부분 실패·최대 동시 4개·취소·타임아웃/재시도/간격.
- TypeScript 검사 및 Vite production build 통과.
- Playwright + Chromium 브라우저 테스트 통과: 모바일 360/375px 및 768/1280px 가로 넘침 없음, 자동 검색, 3/6/24시간 표시, 롱/숏 방향 표시 및 과거 돌파/현재 대기 분리, TradingView 링크, 부분 실패, 전체 실패 시 이전 결과 표시, 취소, 재접속. `test-results/`의 스크린샷은 **테스트 합성 데이터**이며 배포 파일에 포함하지 않습니다.
- 실제 Bybit 연결은 **검증 실패**: 클라우드 curl은 프록시 CONNECT 403, 미리보기의 실제 브라우저 fetch는 `TypeError: Failed to fetch`. 네트워크 차단과 브라우저 CORS/지역 제한을 이 결과만으로 구별할 수 없습니다. 실시간 검색 성공을 확인하지 못했습니다. 실제 앱은 오류를 숨기거나 가짜 시세로 대체하지 않습니다.
- 실사용 브라우저에서도 Bybit 지역 제한·API 접근 정책·CORS에 따라 조회가 실패할 수 있습니다. 우회 프록시·별도 서버를 추가하지 않았습니다.

## GitHub Pages 배포

`.github/workflows/pages.yml`은 `main` push 또는 수동 실행 시 Node 24 → `npm ci` → 단위 테스트 → 빌드 → Pages artifact 업로드 → Pages 배포를 수행합니다. 브라우저 테스트는 로컬 Chromium 검증 단계이며 이 workflow에서는 실행하지 않습니다.

1. GitHub 저장소 **Settings → Pages → Build and deployment → Source: GitHub Actions**를 선택합니다.
2. 저장소의 Actions가 활성화되어 있어야 합니다. 워크플로의 `pages: write`, `id-token: write`와 `github-pages` environment 배포 권한이 필요합니다.
3. `main`에 push하거나 Actions의 **Deploy GitHub Pages → Run workflow**를 실행합니다.
4. Actions의 build/deploy가 모두 성공했는지와 실제 배포 URL 응답을 확인합니다. 예상 주소는 `https://yunsangyeong.github.io/coin-consolidation-breakout/`이며, 배포 성공을 확인하기 전에는 배포 완료 주소로 간주하지 마세요.
5. 실제 배포 사이트에서 Bybit 공개 API 접근·최신 검색을 별도로 확인하세요. GitHub Pages 배포 성공이 Bybit 연결 성공을 뜻하지 않습니다.

첫 코드 push(`d350784`) 뒤 [Pages 실행 #1](https://github.com/YunSangYeong/coin-consolidation-breakout/actions/runs/38252778234)을 GitHub 공개 화면에서 실제 확인했습니다. 실행은 실패했고 `actions/configure-pages`에서 `Get Pages site failed ... configured to build using GitHub Actions ... Not Found`가 보고되었습니다. 따라서 **Pages 배포는 완료되지 않았습니다**. 저장소 관리자가 위 1단계에서 Pages를 활성화하고 Source를 GitHub Actions로 지정한 뒤 워크플로를 다시 실행해야 합니다. 클라우드의 GitHub REST API는 `Forbidden`이므로 이 설정을 직접 변경하지 못했습니다.

환경 설정 초안에 `api.bybit.com`, `api.github.com`, `yunsangyeong.github.io`와 설치·시작 지침을 저장했습니다. 환경 설정에서 검토·저장 후 Publish해야 활성 환경 설정에 반영됩니다. 해당 초안 저장은 GitHub Pages 배포가 아닙니다. Pages URL의 직접 요청도 클라우드 프록시 CONNECT 403으로 차단되어 사이트의 HTTP 상태를 확인하지 못했습니다.
