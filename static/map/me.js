import { BUILDING_PLACES, PERIODS } from './campus-data.js';
import { mondayOf, weekGrid } from './week-grid.js';

const DAYS = [['mon', '월'], ['tue', '화'], ['wed', '수'], ['thu', '목'], ['fri', '금'], ['sat', '토']];
const BUILDINGS = Object.keys(BUILDING_PLACES).sort((a, b) => a.localeCompare(b, 'ko'));
// 시연용 예시: 개설시간표에 있는 컴퓨터공학과 수업으로 만든 가상의 시간표
const SAMPLE = [
  { day: 'mon', start: 5, end: 7, title: '자료구조', building: '이공관', room: '505' },
  { day: 'tue', start: 1, end: 4, title: '프로그래밍기초', building: '이공관', room: '505' },
  { day: 'tue', start: 6, end: 8, title: '데이터베이스응용', building: '이공관', room: '504' },
  { day: 'wed', start: 1, end: 3, title: '전산수학', building: '이공관', room: '505' },
  { day: 'thu', start: 1, end: 3, title: '컴퓨터네트워크', building: '이공관', room: '303' },
  { day: 'thu', start: 5, end: 8, title: 'Node.js프로그래밍', building: '이공관', room: '505' },
];
const place = (lesson) => [lesson.building, lesson.room].filter(Boolean).join(' ') || '강의실 모름';
const dayLabel = (key) => { const [y, m, d] = key.split('-').map(Number); return `${m}/${d}(${'일월화수목금토'[new Date(y, m - 1, d).getDay()]})`; };

export function initMe({ el, api, auth, openReserve }) {
  const page = document.getElementById('me');
  const account = el('section', { className: 'me-account' });
  const side = el('section', { className: 'my-timetable' });
  page.append(account, side);

  let lessons = [];
  let editing = null; // 확인·수정 중인 수업 목록
  let note = '';

  // ---- 계정과 내 예약
  async function renderAccount() {
    const user = auth.user;
    if (!user) {
      account.replaceChildren(
        el('h2', { textContent: '내 정보' }),
        el('p', { className: 'hint', textContent: '로그인하면 시간표가 계정에 저장되고, 내 강의실 예약을 한눈에 볼 수 있어요.' }),
        el('div', { className: 'me-login' },
          el('button', { type: 'button', className: 'primary', textContent: '로그인', onclick: () => auth.open('login') }),
          el('button', { type: 'button', className: 'back', textContent: '회원가입', onclick: () => auth.open('signup') })));
      return;
    }
    const result = await api('/my-reservations');
    if (auth.user !== user) return; // 기다리는 사이 로그아웃했다
    const groups = new Map();
    for (const row of result.ok ? result.data : []) {
      const key = `${row.date} ${row.building} ${row.room}`;
      if (!groups.has(key)) groups.set(key, { ...row, ids: [], periods: [] });
      groups.get(key).ids.push(row.id);
      groups.get(key).periods.push(row.period);
    }
    account.replaceChildren(
      el('h2', { textContent: '내 정보' }),
      el('div', { className: 'me-profile' }, el('b', { className: 'avatar', textContent: user[0].toUpperCase() }),
        el('span', {}, el('strong', { textContent: `${user}님` }), el('small', { textContent: '협성대 지도 계정' }))),
      el('h3', { textContent: '다가오는 예약' }),
      groups.size ? el('ul', { className: 'my-bookings' }, ...[...groups.values()].map((group) => el('li', {},
        el('span', {}, el('strong', { textContent: `${dayLabel(group.date)} ${group.building} ${group.room}호` }),
          el('small', { textContent: `${group.periods.join(', ')}교시 · ${PERIODS[group.periods[0] - 1].start}~${PERIODS[group.periods.at(-1) - 1].end}` })),
        el('button', { type: 'button', className: 'mini', textContent: '보기', onclick: () => openReserve({ building: group.building, no: group.room, floor: group.floor, date: group.date, periods: group.periods }) }),
        el('button', { type: 'button', className: 'mini cancel', textContent: '취소', onclick: () => cancel(group.ids) }))))
        : el('p', { className: 'hint', textContent: '아직 예약한 강의실이 없습니다.' }));
  }
  async function cancel(ids) {
    await Promise.all(ids.map((id) => api(`/reservations/${id}`, 'DELETE')));
    renderAccount();
  }

  // ---- 내 시간표
  function preview() {
    const today = new Date(), monday = mondayOf(today);
    const days = DAYS.map(([key], k) => ({
      date: new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + k),
      lessons: lessons.filter((lesson) => lesson.day === key).map((lesson) => [lesson.start, lesson.end, lesson.title, place(lesson)]),
      booked: [],
    }));
    return weekGrid(days, today);
  }
  function editor() {
    const option = (value, text, selected) => el('option', { value, textContent: text, selected });
    const rows = editing.map((lesson, index) => {
      const set = (key, number) => (event) => { lesson[key] = number ? Number(event.target.value) : event.target.value; };
      return el('div', { className: 'lesson-row' },
        el('select', { ariaLabel: '요일', onchange: set('day') }, ...DAYS.map(([key, name]) => option(key, name, key === lesson.day))),
        el('select', { ariaLabel: '시작 교시', onchange: set('start', true) }, ...PERIODS.map((p) => option(p.no, `${p.start}`, p.no === lesson.start))),
        el('select', { ariaLabel: '끝 교시', onchange: set('end', true) }, ...PERIODS.map((p) => option(p.no, `~${p.end}`, p.no === lesson.end))),
        el('input', { value: lesson.title, ariaLabel: '과목명', placeholder: '과목명', oninput: set('title') }),
        el('select', { ariaLabel: '건물', onchange: set('building') }, option('', '건물 모름', !lesson.building), ...BUILDINGS.map((name) => option(name, name, name === lesson.building))),
        el('input', { value: lesson.room, ariaLabel: '호실', placeholder: '호실', className: 'room-input', oninput: set('room') }),
        el('button', { type: 'button', className: 'mini cancel', textContent: '삭제', onclick: () => { editing.splice(index, 1); renderTimetable(); } }));
    });
    return el('div', { className: 'lesson-editor' },
      el('p', { className: 'hint', textContent: '수업이 맞는지 확인하고 틀린 곳을 고친 뒤 저장하세요.' }),
      ...rows,
      el('button', { type: 'button', className: 'mini', textContent: '+ 수업 추가', onclick: () => { editing.push({ day: 'mon', start: 1, end: 2, title: '', building: '', room: '' }); renderTimetable(); } }),
      el('div', { className: 'editor-actions' },
        el('button', { type: 'button', className: 'back', textContent: '취소', onclick: () => { editing = null; note = ''; renderTimetable(); } }),
        el('button', { type: 'button', className: 'primary', textContent: '이대로 저장', onclick: () => save(editing) })));
  }
  function renderTimetable() {
    const file = el('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => file.files[0] && readImage(file.files[0]) });
    side.replaceChildren(
      el('h2', { textContent: '내 시간표' }),
      el('p', { className: 'hint', textContent: '에브리타임 시간표 캡처를 올리면 AI가 읽어 줍니다. 직접 입력해도 됩니다. AI 챗봇이 이 시간표로 공강 강의실을 찾아 줍니다.' }),
      el('div', { className: 'timetable-actions' },
        file,
        el('button', { type: 'button', className: 'primary', textContent: '사진 올리기', onclick: () => file.click() }),
        ...(editing ? [] : [
          el('button', { type: 'button', className: 'back', textContent: lessons.length ? '수정' : '직접 입력', onclick: () => { editing = lessons.length ? lessons.map((lesson) => ({ ...lesson })) : [{ day: 'mon', start: 1, end: 2, title: '', building: '', room: '' }]; renderTimetable(); } }),
          el('button', { type: 'button', className: 'back', textContent: '예시 시간표', onclick: () => save(SAMPLE.map((lesson) => ({ ...lesson }))) })])),
      ...(note ? [el('p', { className: 'timetable-note', role: 'status', textContent: note })] : []),
      editing ? editor() : lessons.length ? preview() : el('p', { className: 'empty', textContent: '아직 등록한 시간표가 없습니다.' }));
  }
  async function readImage(image) {
    const body = new FormData();
    body.append('image', image);
    note = 'AI가 시간표를 읽는 중입니다…';
    renderTimetable();
    const result = await api('/my-timetable/image', 'POST', body);
    if (!result.ok) { note = result.data?.detail ?? '사진을 읽지 못했습니다.'; renderTimetable(); return; }
    editing = result.data.lessons;
    note = editing.length ? `수업 ${editing.length}개를 읽었습니다.` : '시간표에서 수업을 찾지 못했습니다. 직접 추가하거나 다른 사진을 올려 주세요.';
    renderTimetable();
  }
  async function save(rows) {
    const result = await api('/my-timetable', 'PUT', { lessons: rows });
    if (!result.ok) { note = result.data?.detail ?? '저장하지 못했습니다.'; renderTimetable(); return; }
    lessons = result.data.lessons;
    editing = null;
    note = result.data.saved_to_account
      ? `내 계정에 저장했습니다 (수업 ${lessons.length}개).`
      : `저장했습니다 (수업 ${lessons.length}개). 로그인하지 않아 이 브라우저에만 남습니다.`;
    renderTimetable();
  }
  async function loadTimetable() {
    const result = await api('/my-timetable');
    lessons = result.data?.lessons ?? [];
    if (!editing) renderTimetable();
  }

  // 로그인·로그아웃하면 계정 시간표와 예약이 바뀐다
  auth.onChange(() => {
    editing = null;
    note = '';
    if (!page.hidden) { renderAccount(); loadTimetable(); }
  });

  return {
    async setOpen(open) {
      page.hidden = !open;
      if (!open) return;
      document.body.classList.add('overlay-open');
      await auth.ready;
      renderAccount();
      await loadTimetable();
    },
  };
}
