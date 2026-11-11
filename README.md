# 인협성

인협성은 협성대학교 캠퍼스 웹입니다. 3D 캠퍼스 지도, 카페 메뉴, 층별 평면도, 빈 강의실 조회와 예약을 제공하는 Django 웹입니다.

## 실행 (Windows)

처음 한 번:

```
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python manage.py migrate
.venv\Scripts\python manage.py load_timetable
.venv\Scripts\python manage.py load_professors
.venv\Scripts\python manage.py add_user 아이디 비밀번호
```

실행:

```
.venv\Scripts\python manage.py runserver
```

브라우저에서 http://127.0.0.1:8000 을 엽니다. 3D 라이브러리를 CDN에서 받으므로 인터넷 연결이 필요합니다.

## 계정

- 추가 또는 비밀번호 변경: `manage.py add_user 아이디 비밀번호`
- 관리자 계정: `manage.py add_user 아이디 비밀번호 --admin` 후 http://127.0.0.1:8000/admin

## 테스트

```
.venv\Scripts\python manage.py test
```

로컬 시연용 설정(`DEBUG = True`)이므로 이 상태로 인터넷에 공개하면 안 됩니다.

## 데이터 출처

학교와 관계없는 비공식 프로젝트이며 실측 지도가 아닙니다. 위치 기준점 좌표는 [SMASH-UHS](https://github.com/Hong-Iron/SMASH-UHS)의 데이터에서 뽑았고, 다음 조건을 따릅니다.

- 건물, 도로, 녹지: © OpenStreetMap 기여자, [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/)
- 건물 윤곽, 층수 일부: 국토교통부 디지털트윈국토(브이월드), 공공누리 제1유형

3D 표시에는 three.js(MIT)를 CDN으로 불러옵니다.
