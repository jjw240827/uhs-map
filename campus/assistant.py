"""Gemini로 시간표 사진을 읽고, 공강 강의실 추천 대화를 한다.

모델은 사진 읽기와 말 이해만 맡고, 빈 강의실과 거리는 study.py 도구 결과를 그대로 설명한다.
"""
from django.conf import settings
from google import genai
from google.genai import errors, types
from pydantic import BaseModel

from . import study

TIMEOUT_MS = 60000


class AssistantError(Exception):
    pass


class TimetableRow(BaseModel):
    day: str
    start_time: str
    end_time: str
    title: str
    place: str


EXTRACT_PROMPT = """이 이미지는 대학생의 주간 시간표(에브리타임 등)입니다.
모든 수업 칸을 빠짐없이 읽어 JSON 목록으로 돌려주세요.
- day: mon, tue, wed, thu, fri, sat 중 하나
- start_time, end_time: 24시간제 HH:MM. 칸 위치와 시간 눈금으로 읽고, 칸에 시각이 적혀 있으면 그것을 따릅니다.
- title: 과목명
- place: 칸에 적힌 강의실 글자 그대로 (예: 이공관505). 없으면 빈 문자열
시간표가 아닌 이미지면 빈 목록을 돌려주세요."""

SYSTEM_PROMPT = """당신은 협성대학교 캠퍼스 지도 웹의 AI 도우미입니다. 한국어로 짧고 친절하게 답합니다.
- 공강, 공부할 곳, 빈 강의실 질문에는 반드시 find_study_rooms 도구를 호출하고, 도구 결과에 있는 강의실과 숫자만 말합니다. 강의실을 지어내지 않습니다.
- 사용자가 요일을 말하지 않으면 오늘 요일을 씁니다. 오늘은 {today}({today_name}요일)입니다.
- 등록된 시간표가 없으면 위쪽 '내 정보' 탭의 내 시간표에서 사진을 올리거나 예시 시간표를 불러오라고 안내합니다.
- 답변은 공강 시간, 1순위 강의실과 이유(앞 수업과 다음 수업에서의 이동)를 중심으로 3~5문장. 마크다운 기호(**, #, 표)는 쓰지 않습니다.
- 거리는 지도에서 어림한 값이므로 '약'을 붙입니다.
- 캠퍼스와 관계없는 질문에는 이 웹에서 도울 수 있는 일을 짧게 안내합니다."""


def client():
    if not settings.GEMINI_API_KEY:
        raise AssistantError('AI 키가 설정되지 않았습니다. .env 파일을 확인해 주세요.')
    return genai.Client(api_key=settings.GEMINI_API_KEY,
                        http_options=types.HttpOptions(timeout=TIMEOUT_MS, retry_options=types.HttpRetryOptions(attempts=2)))


def extract_timetable(image, mime_type):
    gemini = client()  # Client가 먼저 정리되면 요청 중에 연결이 닫히므로 변수로 붙잡아 둔다
    try:
        response = gemini.models.generate_content(
            model=settings.GEMINI_MODEL,
            contents=[types.Part.from_bytes(data=image, mime_type=mime_type), EXTRACT_PROMPT],
            config=types.GenerateContentConfig(response_mime_type='application/json', response_schema=list[TimetableRow]),
        )
    except errors.APIError as error:
        raise AssistantError('AI가 사진을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.') from error
    return [row.model_dump() for row in response.parsed or []]


def chat(message, history, lessons, today):
    """history: [{'role': 'user'|'model', 'text': ...}]. (답변, 마지막 추천 계산 결과)를 돌려준다."""
    plans = []

    def find_study_rooms(weekday: str) -> dict:
        """사용자 시간표에서 그 요일의 공강 시간을 찾고, 공강마다 비어 있는 강의실을 앞 수업과 다음 수업 강의실에서 가까운 순으로 돌려준다.

        Args:
            weekday: 요일. mon, tue, wed, thu, fri, sat 중 하나.
        """
        if weekday not in study.WEEKDAYS:
            return {'error': '요일은 mon~sat 중 하나여야 합니다.'}
        if not lessons:
            return {'error': '등록된 시간표가 없습니다.'}
        plan = study.study_plan(lessons, study.WEEKDAYS.index(weekday), today)
        plans.append(plan)
        return plan

    contents = [types.Content(role=turn['role'], parts=[types.Part.from_text(text=turn['text'])]) for turn in history]
    system = SYSTEM_PROMPT.format(today=today.isoformat(), today_name=study.DAY_NAMES[today.weekday()])
    gemini = client()
    try:
        conversation = gemini.chats.create(model=settings.GEMINI_MODEL, history=contents,
                                             config=types.GenerateContentConfig(system_instruction=system, tools=[find_study_rooms]))
        response = conversation.send_message(message)
    except errors.APIError as error:
        raise AssistantError('AI 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.') from error
    return (response.text or '').strip(), plans[-1] if plans else None
