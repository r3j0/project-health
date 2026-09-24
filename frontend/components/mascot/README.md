# 캐릭터 모션

`프라이빗 디자인 대기 모션 제작` 작업의 `/private/tmp/project-health-idle-motion/component`에서 가져온 SVG와 모션 엔진입니다. 메인은 기본 크림 캐릭터의 5.6초 대기 호흡을 사용합니다.

- `BreathingMascot.tsx`: React 연결 및 생성·설정·해제. 의상 UI와 도안은 포함하지 않습니다.
- `breathing-rig.js`: 원본 호흡·걷기 엔진. 숨겨진 탭과 동작 줄이기를 처리하고 언마운트 시 리스너·프레임을 정리합니다.
- `HeadArtwork.tsx`, `head-artwork.js`, `rig-shapes.js`: 원본 얼굴 및 신체 벡터 경로.
- `public/mascots/*-belly.svg`: 배 무늬. 추가 런타임 라이브러리가 필요하지 않습니다.

화면 상태·사용자 프로필·커리큘럼과 독립적입니다. `variant`, `motion`, `cycleSeconds`, `intensity`, `paused`, `label`, `size`로 제어합니다. 장식용으로 사용할 때는 `label=""`을 전달합니다.
