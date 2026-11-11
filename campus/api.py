import re
from datetime import date as Date, timedelta

from django.contrib.auth import authenticate, get_user_model, login, logout
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import File, NinjaAPI, Schema, UploadedFile
from ninja.errors import HttpError
from ninja.security import django_auth
from ninja.utils import check_csrf

from . import assistant, study
from .models import Building, Lesson, Professor, Reservation, Room, StudentTimetable
from .study import LAST_PERIOD, WEEKDAYS

MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_HISTORY = 20
MAX_MESSAGE_LENGTH = 1000
MAX_RANGE_DAYS = 31
TERM = {'source': '2026학년도 2학기 개설시간표(2026.08.03. 기준)', 'year': 2026, 'months': [9, 10, 11, 12]}

api = NinjaAPI(title='협성대 캠퍼스 지도 API')


class Credentials(Schema):
    username: str
    password: str


class MyLesson(Schema):
    day: str
    start: int
    end: int
    title: str
    building: str = ''
    room: str = ''


class MyTimetable(Schema):
    lessons: list[MyLesson]


class ChatTurn(Schema):
    role: str
    text: str


class ChatIn(Schema):
    message: str
    history: list[ChatTurn] = []


class ReservationIn(Schema):
    building: str
    room: str
    date: Date
    periods: list[int]


@api.get('/me')
def me(request):
    return {'username': request.user.username if request.user.is_authenticated else None}


@api.post('/login')
def sign_in(request, data: Credentials):
    # 로그인은 인증 전 요청이라 Ninja가 CSRF를 검사하지 않으므로 직접 확인한다
    rejected = check_csrf(request)
    if rejected:
        return rejected
    user = authenticate(request, username=data.username, password=data.password)
    if user is None:
        raise HttpError(401, '아이디 또는 비밀번호가 맞지 않습니다.')
    login(request, user)
    return {'username': user.username}


@api.post('/signup', response={201: dict})
def sign_up(request, data: Credentials):
    rejected = check_csrf(request)
    if rejected:
        return rejected
    if not re.fullmatch(r'[A-Za-z0-9_]{4,20}', data.username):
        raise HttpError(400, '아이디는 영문, 숫자, _ 조합 4~20자로 입력하세요.')
    User = get_user_model()
    try:
        validate_password(data.password, User(username=data.username))
    except ValidationError as error:
        raise HttpError(400, ' '.join(error.messages))
    try:
        with transaction.atomic():
            user = User.objects.create_user(username=data.username, password=data.password)
    except IntegrityError:
        raise HttpError(409, '이미 사용 중인 아이디입니다.')
    login(request, user, backend='django.contrib.auth.backends.ModelBackend')
    return 201, {'username': user.username}


@api.post('/logout', auth=django_auth)
def sign_out(request):
    logout(request)
    return {'username': None}


@api.get('/timetable')
def timetable(request):
    buildings, floors = {}, {}
    for room in Room.objects.select_related('building').prefetch_related('lessons'):
        days = buildings.setdefault(room.building.name, {}).setdefault(room.number, {})
        floors.setdefault(room.building.name, {})[room.number] = room.floor
        for lesson in room.lessons.all():
            days.setdefault(WEEKDAYS[lesson.weekday], []).append([lesson.start_period, lesson.end_period, lesson.title])
    return {**TERM, 'buildings': buildings, 'floors': floors}


@api.get('/professors')
def professors(request, department: str):
    return list(Professor.objects.filter(department=department).order_by('id').values(
        'name', 'english_name', 'department', 'extension', 'building', 'floor', 'room', 'email', 'photo', 'available', 'timetable'))


@api.get('/reservations')
def reservations(request, date: Date, days: int = 1):
    end = date + timedelta(days=min(max(days, 1), MAX_RANGE_DAYS))
    rows = Reservation.objects.filter(date__gte=date, date__lt=end).select_related('room__building')
    return [{
        'date': row.date.isoformat(),
        'id': row.id if row.user_id == request.user.id else None,
        'building': row.room.building.name,
        'room': row.room.number,
        'period': row.period,
        'mine': row.user_id == request.user.id,
    } for row in rows]


@api.post('/reservations', auth=django_auth, response={201: dict})
def reserve(request, data: ReservationIn):
    periods = sorted(set(data.periods))
    if not periods or not all(1 <= period <= LAST_PERIOD for period in periods):
        raise HttpError(400, '교시가 올바르지 않습니다.')
    if data.date.year != TERM['year'] or data.date.month not in TERM['months']:
        raise HttpError(400, '이번 학기 날짜만 예약할 수 있습니다.')
    if data.date < timezone.localdate():
        raise HttpError(400, '지난 날짜는 예약할 수 없습니다.')
    room = get_object_or_404(Room, building__name=data.building, number=data.room)
    lessons = Lesson.objects.filter(room=room, weekday=data.date.weekday())
    if any(lesson.start_period <= period <= lesson.end_period for lesson in lessons for period in periods):
        raise HttpError(409, '수업이 있는 시간이 포함되어 있습니다.')
    try:
        # 여러 교시는 전부 성공하거나 전부 취소된다
        with transaction.atomic():
            rows = [Reservation.objects.create(user=request.user, room=room, date=data.date, period=period) for period in periods]
    except IntegrityError:
        raise HttpError(409, '이미 예약된 시간이 포함되어 있습니다.')
    return 201, {'ids': [row.id for row in rows]}


@api.get('/my-reservations', auth=django_auth)
def my_reservations(request):
    rows = (Reservation.objects.filter(user=request.user, date__gte=timezone.localdate())
            .select_related('room__building').order_by('date', 'room__building__name', 'room__number', 'period'))
    return [{'id': row.id, 'date': row.date.isoformat(), 'building': row.room.building.name, 'room': row.room.number,
             'floor': row.room.floor, 'period': row.period} for row in rows]


@api.delete('/reservations/{reservation_id}', auth=django_auth, response={204: None})
def cancel(request, reservation_id: int):
    get_object_or_404(Reservation, id=reservation_id, user=request.user).delete()
    return 204, None


# ---- 내 시간표와 AI 챗봇. 로그인하면 계정에 저장하고, 로그인 없이도 쓰도록 세션에도 둔다
def saved_lessons(request):
    if request.user.is_authenticated:
        row = StudentTimetable.objects.filter(user=request.user).first()
        if row:
            return row.lessons
    return request.session.get('my_timetable', [])


def clean_lessons(lessons):
    rows = []
    for lesson in lessons:
        if lesson.day not in WEEKDAYS[:6] or not 1 <= lesson.start <= lesson.end <= LAST_PERIOD:
            raise HttpError(400, '요일이나 교시가 올바르지 않은 수업이 있습니다.')
        rows.append({'day': lesson.day, 'start': lesson.start, 'end': lesson.end, 'title': lesson.title.strip()[:100] or '수업',
                     'building': lesson.building.strip()[:50], 'room': lesson.room.strip()[:20]})
    return sorted(rows, key=lambda row: (WEEKDAYS.index(row['day']), row['start']))


@api.get('/my-timetable')
def my_timetable(request):
    return {'lessons': saved_lessons(request), 'saved_to_account': request.user.is_authenticated}


@api.put('/my-timetable')
def save_my_timetable(request, data: MyTimetable):
    rejected = check_csrf(request)
    if rejected:
        return rejected
    lessons = request.session['my_timetable'] = clean_lessons(data.lessons)
    if request.user.is_authenticated:
        StudentTimetable.objects.update_or_create(user=request.user, defaults={'lessons': lessons})
    return {'lessons': lessons, 'saved_to_account': request.user.is_authenticated}


@api.post('/my-timetable/image')
def read_timetable_image(request, image: UploadedFile = File(...)):
    """사진에서 읽은 수업을 돌려준다. 저장은 사용자가 확인한 뒤 PUT으로 한다."""
    rejected = check_csrf(request)
    if rejected:
        return rejected
    if not (image.content_type or '').startswith('image/') or image.size > MAX_IMAGE_BYTES:
        raise HttpError(400, '8MB 이하의 이미지 파일만 올릴 수 있습니다.')
    try:
        rows = assistant.extract_timetable(image.read(), image.content_type)
    except assistant.AssistantError as error:
        raise HttpError(503, str(error))
    buildings = list(Building.objects.values_list('name', flat=True))
    lessons = []
    for row in rows:
        try:
            start = study.period_from_time(row['start_time'], 'start')
            end = study.period_from_time(row['end_time'], 'end')
        except ValueError:
            continue
        if row['day'] not in WEEKDAYS[:6]:
            continue
        building, room = study.split_place(row['place'], buildings)
        lessons.append({'day': row['day'], 'start': start, 'end': max(start, end), 'title': row['title'].strip()[:100] or '수업',
                        'building': building, 'room': room, 'place': row['place']})
    return {'lessons': lessons, 'read': len(rows)}


@api.post('/chat')
def chat(request, data: ChatIn):
    rejected = check_csrf(request)
    if rejected:
        return rejected
    message = data.message.strip()[:MAX_MESSAGE_LENGTH]
    if not message:
        raise HttpError(400, '메시지를 입력해 주세요.')
    history = [{'role': 'model' if turn.role == 'model' else 'user', 'text': turn.text[:4000]} for turn in data.history[-MAX_HISTORY:]]
    try:
        reply, plan = assistant.chat(message, history, saved_lessons(request), timezone.localdate())
    except assistant.AssistantError as error:
        raise HttpError(503, str(error))
    return {'reply': reply, 'plan': plan}
