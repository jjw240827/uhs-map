# 협성대학교 3D 지도

협성대학교 캠퍼스 안내도의 배치를 참고해 코드로 만든 3D 지도입니다. 접속한 기기의 현재 위치를 지도 위 3D 핀으로 표시합니다. 학교와 관계없는 비공식 프로젝트이며 실측 지도가 아닙니다.

위치 정보는 브라우저 안에서만 쓰이며 서버로 보내지 않습니다.

## 위치 표시 방식

실제 건물 좌표와 그림 속 건물을 기준점으로 짝지어 GPS 좌표를 지도 위 위치로 변환합니다. 그림이 실제 축척과 달라서 위치는 근사치입니다.

## 데이터 출처

위치 기준점은 `data/campus.json`의 좌표에서 뽑았습니다. 이 파일은 [SMASH-UHS](https://github.com/Hong-Iron/SMASH-UHS)의 데이터 파일을 그대로 쓴 것이며, 이 저장소의 코드와 별개로 다음 조건을 따릅니다.

- 건물, 도로, 녹지: © OpenStreetMap 기여자, [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/)
- 고도: AWS Terrain Tiles (SRTM 기반)
- 건물 윤곽, 층수, 지붕색 일부: 국토교통부 디지털트윈국토(브이월드), 공공누리 제1유형

3D 표시에는 three.js(MIT)를 CDN으로 불러옵니다.
