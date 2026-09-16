# 🎨 웹 기반 실시간 인터랙티브 라이브 스케치 미디어아트 (Media Art)

관광지 및 전시 체험존 방문객이 직접 그린 그림(드로잉/도안)을 실시간으로 애니메이션화하여 현장의 대형 미디어월(LED Screen)에 송출하는 인터랙티브 웹 솔루션입니다.

---

## 🌟 주요 기능

1. **키오스크 / 태블릿 드로잉 클라이언트 (`/kiosk`)**
   - 브라우저 Canvas 기반 자유 드로잉 및 도안 채색
   - AI 기반 자동 배경 제거(누끼) 및 골격 추출 시뮬레이션
   - 애니메이션 모션 프리뷰 (걷기, 헤엄치기, 점프, 둥둥 등)
   - 원클릭 미디어월 실시간 전송 (WebSocket 기반)

2. **미디어월 디스플레이 (`/mediawall` 또는 `/`)**
   - 대형 스크린 전용 고해상도 전체 화면 지원
   - WebSocket 기반 실시간 객체 등장 및 자율 유영/이동 물리 엔진
   - 클릭/터치/커서 접근 시 반응하는 인터랙티브 파티클 및 반발 효과
   - 객체 수명(TTL) 관리 및 부드러운 페이드인/아웃

3. **운영자 관리자 대시보드 (`/admin`)**
   - 실시간 연결 상태 모니터링 (미디어월, 키오스크 연결 대수)
   - 테마 변경 (바다, 우주, 숲, 커스텀 배경)
   - 객체 수명(초), 이동 속도 배율 등 실시간 파라미터 제어
   - 송출된 캐릭터 즉시 삭제 및 전체 초기화

---

## 🚀 빠른 시작 가이드 (Getting Started)

### 1. 패키지 설치
```bash
npm install
```

### 2. 서버 실행
```bash
npm start
# 또는
node server.js
```
기본 포트는 `http://localhost:3000`입니다.

### 3. 화면별 접속 경로
- **미디어월 화면**: [http://localhost:3000/mediawall](http://localhost:3000/mediawall)
- **키오스크/태블릿 화면**: [http://localhost:3000/kiosk](http://localhost:3000/kiosk)
- **관리자 대시보드**: [http://localhost:3000/admin](http://localhost:3000/admin)

---

## 🛠 기술 스택
- **Backend**: Node.js, Express, `ws` (WebSocket)
- **Frontend**: HTML5 Canvas, Vanilla CSS3, Modern ES6+ JavaScript
- **Protocol**: WebSocket (양방향 실시간 메시징) & REST API
