"""공강 시간에 공부할 빈 강의실을 찾고, 앞뒤 수업 강의실에서 가까운 순으로 정렬한다.

AI 챗봇은 이 모듈의 결과만 설명하고, 시간과 거리 계산은 모두 여기서 한다.
"""
import math
import re
from datetime import date as Date, timedelta

from .models import Lesson, Reservation, Room

WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
DAY_NAMES = ['월', '화', '수', '목', '금', '토', '일']
LAST_PERIOD = 14

# 지도 기준점(실측 좌표와 안내도 픽셀 32쌍)으로 어림한 건물 위치, 미터. 기준점 교차 검증 오차 중앙값 약 25 m
BUILDING_POSITIONS = {
    '인문사회관': (169, -85), '경영관': (116, 27), '웨슬리창의융합관': (37, 79), '예술관': (29, 211),
    '이공관': (102, 133), '예술대실습관': (149, 91), '학생회관': (-46, 110), '웨슬리관': (-123, 84),
}
FLOOR_METERS = 15  # 한 층 오르내리기를 평지 걷기 거리로 환산한 값
ROOM_STEP_METERS = 5  # 같은 층에서 호실 번호 한 칸 차이
MAX_SAME_FLOOR_METERS = 60
RESULTS_PER_GAP = 3


def period_time(no):
    start = 570 + (no - 1) * 60
    return f'{start // 60:02d}:{start % 60:02d}', f'{(start + 50) // 60:02d}:{(start + 50) % 60:02d}'


def span_text(start, end):
    return f'{period_time(start)[0]}~{period_time(end)[1]}'


def period_from_time(text, edge):
    """'13:30' → 교시. edge='start'면 그 시각에 시작하는 교시, 'end'면 그 시각에 끝나는 교시."""
    hours, minutes = map(int, text.split(':'))
    minute = hours * 60 + minutes
    if edge == 'start':
        no = round((minute - 570) / 60) + 1
    else:
        no = round((minute - 620) / 60) + 1
    return min(max(no, 1), LAST_PERIOD)


def split_place(text, buildings):
    """'이공관5층505호', '이공관 505' 같은 글에서 건물 이름과 호실 번호를 찾는다."""
    text = (text or '').replace(' ', '')
    building = next((name for name in sorted(buildings, key=len, reverse=True) if name in text), '')
    numbers = re.findall(r'[A-Za-z]?\d{3,4}', text.replace(building, '', 1))
    return building, numbers[-1] if numbers else ''


def floor_of(building, number):
    room = Room.objects.filter(building__name=building, number=number).first()
    if room:
        return room.floor
    digits = re.sub(r'\D', '', number)
    if not digits:
        return None
    return int(digits[:-2]) if len(digits) > 2 else 1


def distance(a, b):
    """두 강의실 사이 이동 거리(미터, 어림값)와 설명. 위치를 모르면 None."""
    if not a or not b or a['building'] not in BUILDING_POSITIONS or b['building'] not in BUILDING_POSITIONS:
        return None, '위치를 알 수 없음'
    if a['floor'] is None or b['floor'] is None:
        return None, '층을 알 수 없음'
    if a['building'] == b['building']:
        floors = abs(a['floor'] - b['floor'])
        if floors:
            return floors * FLOOR_METERS, f'{floors}개 층 이동'
        if a['room'] == b['room']:
            return 0, '같은 강의실'
        step = abs(int(re.sub(r'\D', '', a['room'])[-2:] or 0) - int(re.sub(r'\D', '', b['room'])[-2:] or 0))
        return min(step * ROOM_STEP_METERS, MAX_SAME_FLOOR_METERS), '같은 층'
    walk = math.dist(BUILDING_POSITIONS[a['building']], BUILDING_POSITIONS[b['building']])
    stairs = (abs(a['floor'] - 1) + abs(b['floor'] - 1)) * FLOOR_METERS
    return round(walk + stairs), f"{a['building']}에서 {b['building']}(으)로"


def next_date(weekday, today):
    return today + timedelta(days=(weekday - today.weekday()) % 7)


def my_lessons_on(lessons, weekday):
    day = WEEKDAYS[weekday]
    return sorted((lesson for lesson in lessons if lesson['day'] == day), key=lambda lesson: lesson['start'])


def gaps_of(day_lessons):
    """첫 수업과 마지막 수업 사이에 수업이 없는 연속 교시 묶음."""
    if not day_lessons:
        return []
    busy = {no for lesson in day_lessons for no in range(lesson['start'], lesson['end'] + 1)}
    first, last = min(busy), max(busy)
    gaps, current = [], []
    for no in range(first, last + 1):
        if no in busy:
            if current:
                gaps.append((current[0], current[-1]))
            current = []
        else:
            current.append(no)
    return gaps


def free_rooms(weekday, day, start, end):
    """[start, end] 교시 내내 수업도 예약도 없는 강의실."""
    taken = set(Lesson.objects.filter(weekday=weekday, start_period__lte=end, end_period__gte=start).values_list('room_id', flat=True))
    taken |= set(Reservation.objects.filter(date=day, period__gte=start, period__lte=end).values_list('room_id', flat=True))
    return Room.objects.exclude(id__in=taken).select_related('building')


def where(lesson):
    if not lesson or not lesson.get('building') or not lesson.get('room'):
        return None
    return {'building': lesson['building'], 'room': lesson['room'], 'floor': floor_of(lesson['building'], lesson['room'])}


def study_plan(lessons, weekday, today):
    """요일의 공강마다 빈 강의실을 앞뒤 수업에서 가까운 순으로 고른다."""
    day = next_date(weekday, today)
    day_lessons = my_lessons_on(lessons, weekday)
    plan = {
        'weekday': WEEKDAYS[weekday], 'day_name': DAY_NAMES[weekday], 'date': day.isoformat(),
        'lessons': [{**lesson, 'time': span_text(lesson['start'], lesson['end'])} for lesson in day_lessons],
        'gaps': [],
    }
    for start, end in gaps_of(day_lessons):
        before = next(lesson for lesson in reversed(day_lessons) if lesson['end'] < start)
        after = next(lesson for lesson in day_lessons if lesson['start'] > end)
        here, there = where(before), where(after)
        ranked, rooms = [], free_rooms(weekday, day, start, end)
        for room in rooms:
            spot = {'building': room.building.name, 'room': room.number, 'floor': room.floor}
            to_room, from_note = distance(here, spot)
            to_next, next_note = distance(spot, there)
            known = [d for d in (to_room, to_next) if d is not None]
            if not known:
                continue
            ranked.append({**spot, 'meters': round(sum(known)), 'from_previous': from_note, 'to_next': next_note,
                           'from_meters': to_room, 'to_meters': to_next})
        # 거리가 같으면 다음 수업 강의실에 가까운 곳: 공부를 마치고 바로 수업에 들어갈 수 있다
        ranked.sort(key=lambda r: (r['meters'], r['to_meters'] if r['to_meters'] is not None else r['meters'], r['building'], r['room']))
        plan['gaps'].append({
            'start': start, 'end': end, 'time': span_text(start, end), 'periods': list(range(start, end + 1)),
            'previous': {'title': before['title'], **(here or {})}, 'next': {'title': after['title'], **(there or {})},
            'rooms': ranked[:RESULTS_PER_GAP], 'free_count': len(rooms),
        })
    return plan
