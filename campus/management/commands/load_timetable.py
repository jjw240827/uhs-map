import json
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db import transaction

from campus.api import WEEKDAYS
from campus.models import Building, Lesson, Room

SOURCE = Path(__file__).resolve().parents[2] / 'data' / 'timetable.json'
# 평면도에는 있지만 개설시간표에 수업이 없을 수 있는 호실
PLAN_ROOMS = {'이공관': ['501', '502', '503', '504', '505', '801', '802', '803', '804']}


class Command(BaseCommand):
    help = '개설시간표 JSON을 DB에 넣는다. 기존 예약은 유지한다.'

    @transaction.atomic
    def handle(self, *args, **options):
        data = json.loads(SOURCE.read_text(encoding='utf-8'))['buildings']
        Lesson.objects.all().delete()
        lessons = []
        for name, rooms in data.items():
            building, _ = Building.objects.get_or_create(name=name)
            for number, info in rooms.items():
                room, _ = Room.objects.update_or_create(building=building, number=number, defaults={'floor': info['floor']})
                for day, ranges in info['days'].items():
                    lessons += [Lesson(room=room, weekday=WEEKDAYS.index(day), start_period=start, end_period=end, title=title) for start, end, title in ranges]
        Lesson.objects.bulk_create(lessons)
        for name, numbers in PLAN_ROOMS.items():
            building, _ = Building.objects.get_or_create(name=name)
            for number in numbers:
                Room.objects.update_or_create(building=building, number=number, defaults={'floor': int(number[0])})
        self.stdout.write(f'건물 {Building.objects.count()}개, 호실 {Room.objects.count()}개, 수업 {len(lessons)}건')
