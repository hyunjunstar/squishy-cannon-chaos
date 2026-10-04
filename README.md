# 말랑 대포 대소동 (Squishy Cannon Chaos)

물건 2~4개를 배치하고 공 한 발로 연쇄 반응을 일으키는 모바일 물리 퍼즐 프로토타입.

**플레이:** https://hyunjunstar.github.io/squishy-cannon-chaos/

## 실행
```
npm install
npm run dev        # 개발 서버
npm test           # 코어 로직·물리 단위 테스트
npm run test:levels  # 15레벨 정답 재현·재배치·2배속 동일성
npm run e2e        # 브라우저 자동 플레이(1레벨)
npm run shots      # 화면 스크린샷 + 프레임 시간
npm run build      # 웹 빌드(dist/)
```

TypeScript · PixiJS · Planck.js · Vite
