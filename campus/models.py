from django.conf import settings
from django.db import models


class Building(models.Model):
    name = models.CharField(max_length=50, unique=True)

    def __str__(self):
        return self.name


class Room(models.Model):
    building = models.ForeignKey(Building, on_delete=models.CASCADE, related_name='rooms')
    number = models.CharField(max_length=20)
    floor = models.SmallIntegerField(default=1, help_text='지하는 음수')

    class Meta:
        constraints = [models.UniqueConstraint(fields=['building', 'number'], name='unique_building_room')]

    def __str__(self):
        return f'{self.building.name} {self.number}'


class Lesson(models.Model):
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name='lessons')
    weekday = models.PositiveSmallIntegerField(help_text='월요일 0 ~ 일요일 6')
    start_period = models.PositiveSmallIntegerField()
    end_period = models.PositiveSmallIntegerField()
    title = models.CharField(max_length=200, blank=True, default='')

    def __str__(self):
        return f'{self.room} {self.weekday}요일 {self.start_period}-{self.end_period}교시'


class Professor(models.Model):
    name = models.CharField(max_length=30)
    english_name = models.CharField(max_length=60)
    department = models.CharField(max_length=50)
    extension = models.CharField(max_length=20)
    building = models.CharField(max_length=50)
    floor = models.PositiveSmallIntegerField()
    room = models.CharField(max_length=20)
    email = models.EmailField(unique=True)
    photo = models.CharField(max_length=100)
    available = models.BooleanField('상담 가능', default=False)
    timetable = models.JSONField(default=list, blank=True, help_text='[요일, 시작 교시, 끝 교시, 과목명, 강의실] 목록')

    def __str__(self):
        return f'{self.name} ({self.department})'


class Reservation(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='reservations')
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name='reservations')
    date = models.DateField()
    period = models.PositiveSmallIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        # 같은 강의실의 같은 날짜·교시는 DB에서 한 건만 허용한다
        constraints = [models.UniqueConstraint(fields=['room', 'date', 'period'], name='unique_room_date_period')]

    def __str__(self):
        return f'{self.room} {self.date} {self.period}교시 ({self.user})'


class StudentTimetable(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='student_timetable')
    lessons = models.JSONField(default=list, blank=True, help_text='[{day, start, end, title, building, room}] 목록')
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.user} 시간표 ({len(self.lessons)}개)'
