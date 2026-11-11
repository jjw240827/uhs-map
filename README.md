# 협성대학교 3D 지도

협성대학교 캠퍼스를 3D로 보고, 접속한 기기의 현재 위치를 지도에 점으로 표시하는 웹 페이지입니다. 학교와 관계없는 비공식 프로젝트입니다.

위치 정보는 브라우저 안에서만 쓰이며 서버로 보내지 않습니다.

## 데이터 출처

`data/campus.json`은 [SMASH-UHS](https://github.com/Hong-Iron/SMASH-UHS)의 데이터 파일을 그대로 쓴 것이며, 이 저장소의 코드와 별개로 다음 조건을 따릅니다.

- 건물, 도로, 녹지: © OpenStreetMap 기여자, [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/)
- 고도: AWS Terrain Tiles (SRTM 기반)
- 건물 윤곽, 층수, 지붕색 일부: 국토교통부 디지털트윈국토(브이월드), 공공누리 제1유형

3D 표시에는 three.js(MIT)를 CDN으로 불러옵니다.
