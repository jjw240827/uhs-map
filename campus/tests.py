import json
from datetime import date
from io import StringIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.db import IntegrityError, transaction
from django.test import Client, TestCase

from . import study
from .assistant import AssistantError
from .models import Building, Lesson, Professor, Reservation, Room, StudentTimetable

TODAY = date(2026, 11, 2)
MONDAY = '2026-11-09'


class SignUpTests(TestCase):
    def post(self, client, username, password):
        return client.post('/api/signup', json.dumps({'username': username, 'password': password}), content_type='application/json')

    def test_signup_logs_in_and_hashes_password(self):
        client = Client()
        self.assertEqual(self.post(client, 'newuser1', 'campus-map-2026').status_code, 201)
        self.assertEqual(client.get('/api/me').json()['username'], 'newuser1')
        user = get_user_model().objects.get(username='newuser1')
        self.assertNotEqual(user.password, 'campus-map-2026')
        self.assertFalse(user.is_staff)

    def test_duplicate_username_rejected(self):
        self.post(Client(), 'newuser1', 'campus-map-2026')
        self.assertEqual(self.post(Client(), 'newuser1', 'other-pass-2026').status_code, 409)
        self.assertEqual(get_user_model().objects.count(), 1)

    def test_invalid_input_rejected(self):
        self.assertEqual(self.post(Client(), 'ab', 'campus-map-2026').status_code, 400)
        self.assertEqual(self.post(Client(), 'bad id!', 'campus-map-2026').status_code, 400)
        self.assertEqual(self.post(Client(), 'newuser1', '123').status_code, 400)
        self.assertFalse(get_user_model().objects.exists())

    def test_csrf_enforced(self):
        self.assertEqual(self.post(Client(enforce_csrf_checks=True), 'newuser1', 'campus-map-2026').status_code, 403)


class ProfessorTests(TestCase):
    def test_initial_status_and_reload_keeps_changes(self):
        call_command('load_professors', stdout=StringIO())
        available = Professor.objects.filter(available=True).values_list('name', flat=True)
        self.assertEqual(list(available), ['윤회진'])
        Professor.objects.filter(name='이수종').update(available=True)
        call_command('load_professors', stdout=StringIO())
        self.assertTrue(Professor.objects.get(name='이수종').available)

    def test_department_filter(self):
        call_command('load_professors', stdout=StringIO())
        self.assertEqual(len(Client().get('/api/professors', {'department': '컴퓨터공학과'}).json()), 4)
        self.assertEqual(Client().get('/api/professors', {'department': '도시공학과'}).json(), [])

    def test_timetable_from_pdf(self):
        call_command('load_professors', stdout=StringIO())
        rows = {p['name']: p['timetable'] for p in Client().get('/api/professors', {'department': '컴퓨터공학과'}).json()}
        self.assertEqual({name: len(lessons) for name, lessons in rows.items()}, {'한정란': 4, '이수종': 4, '윤회진': 5, '홍석주': 3})
        self.assertIn(['tue', 1, 4, '프로그래밍기초', '이공관5층505호'], rows['윤회진'])


@patch('campus.api.timezone.localdate', return_value=TODAY)
class ReservationTests(TestCase):
    def setUp(self):
        users = get_user_model().objects
        self.kim = users.create_user('kim', password='pw-kim')
        self.lee = users.create_user('lee', password='pw-lee')
        self.room = Room.objects.create(building=Building.objects.create(name='이공관'), number='501')
        Lesson.objects.create(room=self.room, weekday=0, start_period=1, end_period=3)

    def client_for(self, user):
        client = Client()
        client.force_login(user)
        return client

    def post(self, client, **changes):
        body = {'building': '이공관', 'room': '501', 'date': MONDAY, 'periods': [5], **changes}
        return client.post('/api/reservations', json.dumps(body), content_type='application/json')

    def test_database_rejects_duplicate(self, _):
        Reservation.objects.create(user=self.kim, room=self.room, date=MONDAY, period=5)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Reservation.objects.create(user=self.lee, room=self.room, date=MONDAY, period=5)

    def test_second_user_gets_conflict(self, _):
        self.assertEqual(self.post(self.client_for(self.kim)).status_code, 201)
        self.assertEqual(self.post(self.client_for(self.lee)).status_code, 409)
        self.assertEqual(Reservation.objects.count(), 1)

    def test_multiple_periods_all_or_nothing(self, _):
        self.assertEqual(self.post(self.client_for(self.kim)).status_code, 201)
        lee = self.client_for(self.lee)
        self.assertEqual(self.post(lee, periods=[4, 5, 6]).status_code, 409)
        self.assertEqual(Reservation.objects.filter(user=self.lee).count(), 0)
        self.assertEqual(self.post(lee, periods=[3, 4]).status_code, 409)  # 3교시는 수업
        self.assertEqual(Reservation.objects.filter(user=self.lee).count(), 0)
        self.assertEqual(self.post(lee, periods=[6, 7, 7]).status_code, 201)
        self.assertEqual(sorted(Reservation.objects.filter(user=self.lee).values_list('period', flat=True)), [6, 7])

    def test_empty_periods_rejected(self, _):
        self.assertEqual(self.post(self.client_for(self.kim), periods=[]).status_code, 400)

    def test_login_required(self, _):
        self.assertEqual(self.post(Client()).status_code, 401)

    def test_lesson_time_rejected(self, _):
        self.assertEqual(self.post(self.client_for(self.kim), periods=[2]).status_code, 409)

    def test_invalid_period_and_dates_rejected(self, _):
        client = self.client_for(self.kim)
        self.assertEqual(self.post(client, periods=[15]).status_code, 400)
        self.assertEqual(self.post(client, date='2026-11-01').status_code, 400)
        self.assertEqual(self.post(client, date='2027-03-02').status_code, 400)

    def test_only_owner_can_cancel(self, _):
        row = Reservation.objects.create(user=self.kim, room=self.room, date=MONDAY, period=5)
        self.assertEqual(self.client_for(self.lee).delete(f'/api/reservations/{row.id}').status_code, 404)
        self.assertEqual(self.client_for(self.kim).delete(f'/api/reservations/{row.id}').status_code, 204)
        self.assertFalse(Reservation.objects.exists())

    def test_other_users_reservation_hides_id(self, _):
        Reservation.objects.create(user=self.kim, room=self.room, date=MONDAY, period=5)
        row = self.client_for(self.lee).get(f'/api/reservations?date={MONDAY}').json()[0]
        self.assertEqual((row['id'], row['mine']), (None, False))

    def test_reservations_week_range(self, _):
        Reservation.objects.create(user=self.kim, room=self.room, date='2026-11-09', period=5)
        Reservation.objects.create(user=self.kim, room=self.room, date='2026-11-15', period=5)
        Reservation.objects.create(user=self.kim, room=self.room, date='2026-11-16', period=5)
        rows = Client().get('/api/reservations', {'date': MONDAY, 'days': 7}).json()
        self.assertEqual(sorted(row['date'] for row in rows), ['2026-11-09', '2026-11-15'])

    def test_timetable_includes_floor_and_title(self, _):
        Lesson.objects.filter(room=self.room).update(title='자료구조')
        Room.objects.filter(pk=self.room.pk).update(floor=5)
        data = Client().get('/api/timetable').json()
        self.assertEqual(data['floors']['이공관']['501'], 5)
        self.assertEqual(data['buildings']['이공관']['501']['mon'], [[1, 3, '자료구조']])

    def test_login(self, _):
        client = Client()
        body = lambda password: json.dumps({'username': 'kim', 'password': password})
        self.assertEqual(client.post('/api/login', body('wrong'), content_type='application/json').status_code, 401)
        self.assertEqual(client.post('/api/login', body('pw-kim'), content_type='application/json').status_code, 200)
        self.assertEqual(client.get('/api/me').json()['username'], 'kim')

    def test_csrf_enforced(self, _):
        client = Client(enforce_csrf_checks=True)
        body = json.dumps({'username': 'kim', 'password': 'pw-kim'})
        self.assertEqual(client.post('/api/login', body, content_type='application/json').status_code, 403)
        client.force_login(self.kim)
        self.assertEqual(self.post(client).status_code, 403)


class StudyPlanTests(TestCase):
    THURSDAY = date(2026, 11, 12)
    MINE = [
        {'day': 'thu', 'start': 1, 'end': 3, 'title': '컴퓨터네트워크', 'building': '이공관', 'room': '303'},
        {'day': 'thu', 'start': 5, 'end': 8, 'title': 'Node.js프로그래밍', 'building': '이공관', 'room': '505'},
    ]

    def setUp(self):
        it, biz = Building.objects.create(name='이공관'), Building.objects.create(name='경영관')
        self.rooms = {no: Room.objects.create(building=it, number=no, floor=int(no[0])) for no in ['303', '405', '505', '701', '904']}
        self.rooms['경영502'] = Room.objects.create(building=biz, number='502', floor=5)
        Lesson.objects.create(room=self.rooms['405'], weekday=3, start_period=4, end_period=4, title='수업')
        Reservation.objects.create(user=get_user_model().objects.create_user('kim', password='x'), room=self.rooms['904'], date=self.THURSDAY, period=4)

    def test_gaps_between_lessons(self):
        lesson = lambda start, end: {'day': 'mon', 'start': start, 'end': end}
        self.assertEqual(study.gaps_of([lesson(1, 3), lesson(5, 8)]), [(4, 4)])
        self.assertEqual(study.gaps_of([lesson(1, 2), lesson(6, 6), lesson(9, 9)]), [(3, 5), (7, 8)])
        self.assertEqual(study.gaps_of([lesson(1, 4), lesson(5, 6)]), [])

    def test_free_rooms_ranked_by_walking(self):
        plan = study.study_plan(self.MINE, 3, date(2026, 11, 11))
        self.assertEqual(plan['date'], '2026-11-12')
        [gap] = plan['gaps']
        self.assertEqual((gap['time'], gap['periods']), ('12:30~13:20', [4]))
        names = [f"{room['building']} {room['room']}" for room in gap['rooms']]
        # 405는 수업, 904는 예약이 있어 빠지고, 다음 수업 강의실(505)이 같은 거리 중 먼저 온다
        self.assertEqual(names, ['이공관 505', '이공관 303', '이공관 701'])
        self.assertEqual(gap['free_count'], 4)
        self.assertNotIn('경영관 502', names)

    def test_place_and_time_parsing(self):
        self.assertEqual(study.split_place('이공관5층505호', ['이공관', '경영관']), ('이공관', '505'))
        self.assertEqual(study.split_place('', ['이공관']), ('', ''))
        self.assertEqual((study.period_from_time('13:30', 'start'), study.period_from_time('16:20', 'end')), (5, 7))


class ChatApiTests(TestCase):
    def test_timetable_saved_in_session(self):
        client = Client()
        body = {'lessons': [{'day': 'thu', 'start': 5, 'end': 8, 'title': ' Node.js ', 'building': '이공관', 'room': '505'}]}
        self.assertEqual(client.put('/api/my-timetable', json.dumps(body), content_type='application/json').status_code, 200)
        self.assertEqual(client.get('/api/my-timetable').json()['lessons'][0]['title'], 'Node.js')
        self.assertEqual(Client().get('/api/my-timetable').json()['lessons'], [])
        body['lessons'][0]['end'] = 3
        self.assertEqual(client.put('/api/my-timetable', json.dumps(body), content_type='application/json').status_code, 400)

    @patch('campus.api.assistant.extract_timetable', return_value=[
        {'day': 'thu', 'start_time': '13:30', 'end_time': '17:20', 'title': 'Node.js프로그래밍', 'place': '이공관5층505호'},
        {'day': 'sun', 'start_time': '09:30', 'end_time': '10:20', 'title': '이상한 칸', 'place': ''}])
    def test_image_rows_converted_not_saved(self, _):
        Building.objects.create(name='이공관')
        client = Client()
        image = SimpleUploadedFile('tt.png', b'png', content_type='image/png')
        result = client.post('/api/my-timetable/image', {'image': image}).json()
        self.assertEqual(result['lessons'], [{'day': 'thu', 'start': 5, 'end': 8, 'title': 'Node.js프로그래밍', 'building': '이공관', 'room': '505', 'place': '이공관5층505호'}])
        self.assertEqual(client.get('/api/my-timetable').json()['lessons'], [])
        text = SimpleUploadedFile('a.txt', b'hi', content_type='text/plain')
        self.assertEqual(client.post('/api/my-timetable/image', {'image': text}).status_code, 400)

    def test_chat_passes_session_timetable(self):
        client = Client()
        lesson = {'day': 'thu', 'start': 1, 'end': 3, 'title': '네트워크', 'building': '', 'room': ''}
        client.put('/api/my-timetable', json.dumps({'lessons': [lesson]}), content_type='application/json')
        with patch('campus.api.assistant.chat', return_value=('추천합니다', None)) as chat:
            response = client.post('/api/chat', json.dumps({'message': '목요일 공강', 'history': [{'role': 'model', 'text': '안녕'}]}), content_type='application/json')
        self.assertEqual(response.json(), {'reply': '추천합니다', 'plan': None})
        message, history, lessons, _ = chat.call_args.args
        self.assertEqual((message, history, lessons), ('목요일 공강', [{'role': 'model', 'text': '안녕'}], [lesson]))

    def test_chat_errors(self):
        self.assertEqual(Client().post('/api/chat', json.dumps({'message': '  '}), content_type='application/json').status_code, 400)
        with patch('campus.api.assistant.chat', side_effect=AssistantError('AI 응답을 받지 못했습니다.')):
            response = Client().post('/api/chat', json.dumps({'message': '안녕'}), content_type='application/json')
        self.assertEqual(response.status_code, 503)

    def test_timetable_kept_in_account_after_logout(self):
        get_user_model().objects.create_user(username='student1', password='pass-word-123')
        client = Client()
        client.post('/api/login', json.dumps({'username': 'student1', 'password': 'pass-word-123'}), content_type='application/json')
        lesson = {'day': 'mon', 'start': 1, 'end': 2, 'title': '전산수학', 'building': '이공관', 'room': '505'}
        saved = client.put('/api/my-timetable', json.dumps({'lessons': [lesson]}), content_type='application/json').json()
        self.assertTrue(saved['saved_to_account'])
        client.post('/api/logout')
        self.assertEqual(client.get('/api/my-timetable').json()['lessons'], [])
        client.post('/api/login', json.dumps({'username': 'student1', 'password': 'pass-word-123'}), content_type='application/json')
        self.assertEqual(client.get('/api/my-timetable').json()['lessons'], [lesson])
        self.assertEqual(StudentTimetable.objects.count(), 1)

    @patch('django.utils.timezone.localdate', return_value=TODAY)
    def test_my_reservations_upcoming_only(self, _):
        user = get_user_model().objects.create_user(username='student2', password='pass-word-123')
        room = Room.objects.create(building=Building.objects.create(name='이공관'), number='505', floor=5)
        Reservation.objects.create(user=user, room=room, date=date(2026, 11, 1), period=1)
        Reservation.objects.create(user=user, room=room, date=date(2026, 11, 3), period=2)
        client = Client()
        self.assertEqual(client.get('/api/my-reservations').status_code, 401)
        client.force_login(user)
        rows = client.get('/api/my-reservations').json()
        self.assertEqual([(row['date'], row['period'], row['floor']) for row in rows], [('2026-11-03', 2, 5)])
