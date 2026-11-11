from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = '아이디와 비밀번호로 계정을 만든다. 이미 있으면 비밀번호를 바꾼다.'

    def add_arguments(self, parser):
        parser.add_argument('username')
        parser.add_argument('password')
        parser.add_argument('--admin', action='store_true', help='관리자 화면(/admin)도 쓸 수 있게 한다')

    def handle(self, *args, username, password, admin, **options):
        user, created = get_user_model().objects.get_or_create(username=username)
        user.set_password(password)
        user.is_staff = user.is_superuser = admin
        user.save()
        self.stdout.write(f'{username} 계정을 {"만들었습니다" if created else "수정했습니다"}.')
