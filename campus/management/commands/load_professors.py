import json
from pathlib import Path

from django.core.management.base import BaseCommand

from campus.models import Professor

DATA_FILE = Path(__file__).resolve().parents[2] / 'data' / 'professor_timetable.json'
DEPARTMENT = '컴퓨터공학과'
PROFESSORS = [
    {'name': '한정란', 'english_name': 'Jung Lan Han', 'extension': '031-299-0844', 'building': '이공관', 'floor': 7, 'room': '706', 'email': 'jlhan@uhs.ac.kr', 'photo': 'jlhan.jpg'},
    {'name': '이수종', 'english_name': 'LEE SOO-JONG', 'extension': '031-299-0767', 'building': '이공관', 'floor': 5, 'room': '508', 'email': 'sjlee@omail.uhs.ac.kr', 'photo': 'sjlee.jpg'},
    {'name': '윤회진', 'english_name': 'Yoon, Hoijin', 'extension': '031-299-0841', 'building': '이공관', 'floor': 5, 'room': '507', 'email': 'hj.yoon@uhs.ac.kr', 'photo': 'hjyoon.jpg'},
    {'name': '홍석주', 'english_name': 'SuckJoo Hong', 'extension': '031-299-1321', 'building': '경영관', 'floor': 5, 'room': '525', 'email': 'sjhong@omail.uhs.ac.kr', 'photo': 'sjhong.jpg'},
]
# 교수가 직접 설정하는 기능을 넣기 전까지 쓰는 임시 초기값
AVAILABLE_AT_START = {'윤회진'}


class Command(BaseCommand):
    help = '교수 정보를 DB에 넣는다. 이미 있는 교수의 상담 상태는 바꾸지 않는다.'

    def handle(self, *args, **options):
        timetables = json.loads(DATA_FILE.read_text(encoding='utf-8'))
        for info in PROFESSORS:
            fields = {**info, 'department': DEPARTMENT, 'timetable': timetables[info['name']]}
            Professor.objects.update_or_create(
                email=info['email'], defaults=fields,
                create_defaults={**fields, 'available': info['name'] in AVAILABLE_AT_START},
            )
        self.stdout.write(f'교수 {Professor.objects.count()}명')
