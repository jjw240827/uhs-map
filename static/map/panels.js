import { BUILDING_PLACES, CAFE_MENU, CAFES, FLOOR_COUNTS, FLOOR_PLANS, PERIODS } from './campus-data.js';
import { initFaculty } from './faculty.js';
import { initShuttle, upcomingDepartures } from './shuttle.js';
import { initChat } from './chat.js';
import { initAuth } from './auth.js';
import { initMe } from './me.js';
import { mondayOf, weekGrid } from './week-grid.js';

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const QUICK_READY = new Set(['study', 'cafe']);
const PLAN_BUILDING = '이공관';
const LIVE_REFRESH_MS = 30000;
const NARROW_ROOM = 200;
const SVG_NS = 'http://www.w3.org/2000/svg';
const EXAMPLE_NOTE = ' (예시 배치)';

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const won = (value) => value.toLocaleString('ko-KR');
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const floorLabel = (floor) => (floor < 0 ? `B${-floor}층` : `${floor}층`);
const normalize = (text) => text.replace(/[\s호]/g, '').toLowerCase();

async function api(path, method = 'GET', body) {
  const csrf = document.cookie.match(/csrftoken=([^;]+)/)?.[1] ?? '';
  try {
    const response = await fetch(`/api${path}`, {
      method,
      // 사진 업로드(FormData)는 브라우저가 Content-Type을 정하게 둔다
      headers: body instanceof FormData ? { 'X-CSRFToken': csrf } : { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
      body: body instanceof FormData ? body : body && JSON.stringify(body),
    });
    return { ok: response.ok, status: response.status, data: await response.json().catch(() => null) };
  } catch {
    return { ok: false, status: 0, data: { detail: '서버에 연결하지 못했습니다.' } };
  }
}

const bookingMap = (rows) => new Map(rows.map((row) => [`${row.building}|${row.room}|${row.period}`, row]));
const periodAt = (minutes) => PERIODS.find((p) => minutes >= p.startMin && minutes < p.startMin + 60);

const BUS_STOP_ID = 17;

export function initPanels(map) {
  const legendParts = ['brand', 'items', 'actions'].map((id) => document.getElementById(id));
  const view = document.getElementById('side-view');
  const stage = document.getElementById('plan-stage');
  const quickNote = document.getElementById('quick-note');
  const quickButtons = [...document.querySelectorAll('#quick button')];
  const planRooms = new Map(Object.values(FLOOR_PLANS).flatMap((plan) => plan.rooms.filter((r) => r.bookable).map((r) => [r.no, r])));

  let timetable = null;
  let timetableRequest = null;
  let reserved = new Map();
  let rerenderReserve = null;
  const auth = initAuth({ el, api, box: document.getElementById('site-auth') });
  const loadTimetable = () => {
    timetableRequest ??= api('/timetable').then((r) => { timetable = r.ok ? r.data : null; });
    return timetableRequest;
  };

  function roomsOf(building) {
    const plans = building === PLAN_BUILDING ? planRooms : new Map();
    const numbers = new Set([...plans.keys(), ...Object.keys(timetable?.buildings?.[building] ?? {})]);
    return [...numbers].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).map((no) => ({
      building, no, bookable: true,
      name: plans.get(no)?.name ?? '강의실',
      en: plans.get(no)?.en,
      floor: timetable?.floors?.[building]?.[no] ?? Number(no[0]),
    }));
  }
  const planFor = (room) => FLOOR_PLANS[`${BUILDING_PLACES[room.building]}-${room.floor}`];
  const inTerm = (date) => date.getFullYear() === timetable?.year && timetable.months.includes(date.getMonth() + 1);

  // 해당 날짜에 쓰이는 교시: 교시 번호 → { kind, mine, id }
  function usedPeriods(room, date, booked) {
    const used = new Map();
    if (inTerm(date)) {
      for (const [from, to] of timetable.buildings?.[room.building]?.[room.no]?.[WEEKDAYS[date.getDay()]] ?? []) {
        for (let period = from; period <= to; period++) used.set(period, { kind: 'lesson' });
      }
    }
    for (const { no } of PERIODS) {
      const booking = booked.get(`${room.building}|${room.no}|${no}`);
      if (booking) used.set(no, { kind: 'booked', mine: booking.mine, id: booking.id });
    }
    return used;
  }
  // 이어진 교시를 합쳐 "언제부터 언제까지"를 만든다
  function busyStatus(used, period) {
    let first = period, last = period;
    while (used.has(first - 1)) first--;
    while (used.has(last + 1)) last++;
    const current = used.get(period);
    return { busy: true, mine: current.mine, start: PERIODS[first - 1].start, end: PERIODS[last - 1].end, note: current.kind === 'lesson' ? '강의 중' : '예약 중' };
  }
  function liveStatus(room, now, booked) {
    const used = usedPeriods(room, now, booked);
    const minutes = now.getHours() * 60 + now.getMinutes();
    const period = periodAt(minutes);
    if (!period || !used.has(period.no)) return { busy: false };
    if (minutes >= period.endMin && !used.has(period.no + 1)) return { busy: false }; // 수업이 끝난 뒤 쉬는 시간
    return busyStatus(used, period.no);
  }

  function setQuick(id) {
    for (const button of quickButtons) button.classList.toggle('on', button.dataset.id === id);
  }
  function hideStage() {
    stage.hidden = true;
    stage.replaceChildren();
  }
  function showStage(title, svg) {
    stage.replaceChildren(el('h3', { textContent: title }), svg);
    stage.hidden = false;
  }
  function showView(...content) {
    hideStage();
    legendParts.forEach((part) => { part.hidden = true; });
    view.hidden = false;
    view.replaceChildren(...content);
    view.scrollTop = 0;
  }
  function showLegend() {
    hideStage();
    view.hidden = true;
    view.replaceChildren();
    legendParts.forEach((part) => { part.hidden = false; });
  }
  const backButton = (label, action) => el('button', { type: 'button', className: 'back', textContent: `← ${label}`, onclick: action });
  function backToLegend() {
    setQuick(null);
    map.setGlow([]);
    map.clearRoutes();
    showLegend();
  }

  // ---- 카페
  function cafeMenu() {
    return CAFE_MENU.map(({ title, items }) => el('section', { className: 'menu-group' },
      el('h3', { textContent: title }),
      el('ul', {}, ...items.map(([name, hot, ice]) => el('li', {},
        el('span', { textContent: name }),
        el('span', { className: 'prices' },
          ...(hot === null ? [] : [el('b', { className: 'hot', textContent: won(hot) })]),
          ...(hot !== null && ice !== null ? ['/'] : []),
          ...(ice === null ? [] : [el('b', { className: 'ice', textContent: won(ice) })])))))));
  }
  function showCafe(selectedId = CAFES[0].id) {
    const tabs = el('div', { className: 'tabs' }, ...CAFES.map((cafe) => el('button', {
      type: 'button', textContent: cafe.name, className: cafe.id === selectedId ? 'on' : '', onclick: () => showCafe(cafe.id),
    })));
    showView(backButton('건물 목록', backToLegend), el('h2', { textContent: '카페 메뉴' }), tabs,
      el('p', { className: 'legend-line', innerHTML: '<b class="hot">HOT</b> / <b class="ice">ICE</b> · 단위 원' }), ...cafeMenu());
  }

  // ---- 정문에서 가는 길
  const GATE_ID = 16;
  function wayList(place) {
    if (place.id === GATE_ID) return el('section', { className: 'way-list' }, el('h3', { textContent: '길 안내' }), el('p', { className: 'hint', textContent: '모든 길 안내는 정문에서 출발합니다. 건물을 고르면 빨간 화살표로 가는 길을 보여 줍니다.' }));
    const routes = map.routesFor(place.id);
    if (!routes.length) return null;
    let picked = null;
    const buttons = routes.map((route, index) => el('button', {
      type: 'button', className: 'way-option',
      onclick: () => {
        picked = picked === index ? null : index;
        buttons.forEach((button, k) => button.classList.toggle('on', k === picked));
        map.showRoute(place.id, picked);
      },
    }, el('b', {}, route.name, ...(route.kind === 'shortcut' ? [el('span', { className: 'tag', textContent: '지름길' })] : [])),
    el('ol', {}, ...route.steps.map((step) => el('li', { textContent: step })))));
    const hint = routes.some((route) => route.kind === 'shortcut')
      ? '빨간 화살표를 따라가세요. 지름길 화살표에 마우스를 올리면(폰은 누르면) 설명이 나옵니다.'
      : '지도의 빨간 화살표를 따라가세요.';
    return el('section', { className: 'way-list' },
      el('h3', { textContent: '정문에서 가는 길' }),
      el('p', { className: 'hint', textContent: routes.length > 1 ? `${hint} 길을 누르면 그 길만 보입니다.` : hint }),
      ...buttons);
  }

  // ---- 건물과 층
  function showBusStop(place) {
    const buses = upcomingDepartures();
    showView(backButton('건물 목록', backToLegend), el('h2', { textContent: place.name }),
      el('p', { className: 'hint', textContent: '통학버스를 타고 내리는 곳입니다.' }),
      el('section', { className: 'menu-group' },
        el('h3', { textContent: '곧 출발하는 하교 버스' }),
        buses.length
          ? el('ul', {}, ...buses.map((bus) => el('li', {}, el('b', { textContent: bus.text }), el('span', { textContent: `학교 → ${bus.route}` }))))
          : el('p', { className: 'hint', textContent: '오늘 남은 하교 버스가 없습니다.' })),
      el('button', { type: 'button', className: 'primary bus-all', textContent: '셔틀 시간표 전체 보기', onclick: () => goTo('shuttle') }),
      ...[wayList(place)].filter(Boolean));
  }
  function showBuilding(place) {
    if (place.id === BUS_STOP_ID) { showBusStop(place); return; }
    const count = FLOOR_COUNTS[place.id], ways = wayList(place);
    if (!count && !ways) { showLegend(); return; }
    const floors = Array.from({ length: count ?? 0 }, (_, k) => count - k);
    showView(backButton('건물 목록', backToLegend), el('h2', { textContent: place.name }),
      ...(count ? [el('p', { className: 'hint', textContent: '층을 누르면 평면도를 볼 수 있습니다.' }),
        el('div', { className: 'floors' }, ...floors.map((floor) => el('button', {
          type: 'button', textContent: `${floor}층`, className: FLOOR_PLANS[`${place.id}-${floor}`] ? 'has-plan' : '', onclick: () => showFloor(place, floor),
        })))] : []),
      ...(ways ? [ways] : []));
  }
  function showFloor(place, floor) {
    const plan = FLOOR_PLANS[`${place.id}-${floor}`];
    const head = [backButton(place.name, () => showBuilding(place)), el('h2', { textContent: `${place.name} ${floor}층` })];
    if (!plan) {
      showView(...head, el('p', { className: 'empty', textContent: '이 층의 평면도는 아직 준비되지 않았습니다.' }));
      return;
    }
    const info = el('div', { className: 'room-info' }, el('p', { className: 'hint', textContent: '호실을 누르면 시간표가 나옵니다.' }));
    showView(...head, info);
    showStage(`${place.name} ${floor}층${plan.example ? EXAMPLE_NOTE : ''}`, livePlan(plan, info));
  }

  function floorSvg(plan, onRoom) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', plan.viewBox);
    svg.setAttribute('class', 'plan');
    svg.setAttribute('role', 'img');
    const shape = (points, className) => {
      const polygon = document.createElementNS(SVG_NS, 'polygon');
      polygon.setAttribute('points', points.map((p) => p.join(',')).join(' '));
      polygon.setAttribute('class', className);
      return polygon;
    };
    const label = (points, text, className) => {
      const node = document.createElementNS(SVG_NS, 'text');
      node.setAttribute('x', points.reduce((s, p) => s + p[0], 0) / points.length);
      node.setAttribute('y', points.reduce((s, p) => s + p[1], 0) / points.length);
      node.setAttribute('class', className);
      node.textContent = text;
      return node;
    };
    for (const points of plan.corridor) svg.append(shape(points, 'corridor'));
    for (const { label: text, points } of plan.areas) svg.append(shape(points, 'service'), label(points, text, 'service-label'));
    for (const room of plan.rooms) {
      const group = document.createElementNS(SVG_NS, 'g');
      group.setAttribute('class', `room ${room.bookable ? 'bookable' : 'office'}`);
      group.setAttribute('tabindex', '0');
      group.setAttribute('role', 'button');
      group.setAttribute('aria-label', `${room.no}호 ${room.name}`);
      group.dataset.room = room.no;
      const xs = room.points.map((p) => p[0]);
      group.dataset.width = Math.max(...xs) - Math.min(...xs);
      group.append(shape(room.points, 'room-shape'), label(room.points, room.no, 'room-label'));
      const open = () => {
        if (group.classList.contains('locked')) return;
        svg.querySelectorAll('.room.on').forEach((node) => node.classList.remove('on'));
        group.classList.add('on');
        onRoom(room);
      };
      group.addEventListener('click', open);
      group.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
      svg.append(group);
    }
    return svg;
  }
  // 사용 중인 호실을 빨갛게 칠하고 사용 시간을 적는다
  function paintPlan(svg, statusOf) {
    for (const group of svg.querySelectorAll('.room.bookable')) {
      const status = statusOf(group.dataset.room);
      const number = group.querySelector('.room-label');
      group.querySelector('.room-status')?.remove();
      number.dataset.y ??= number.getAttribute('y');
      group.classList.toggle('busy', Boolean(status?.busy));
      group.classList.toggle('locked', Boolean(status?.locked));
      if (!status?.busy) { number.setAttribute('y', number.dataset.y); continue; }
      const lines = Number(group.dataset.width) < NARROW_ROOM ? [status.start, `~${status.end}`, status.note] : [`${status.start}~${status.end}`, status.note];
      const y = Number(number.dataset.y);
      number.setAttribute('y', y - 14 * lines.length);
      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('class', 'room-status');
      lines.forEach((line, index) => {
        const span = document.createElementNS(SVG_NS, 'tspan');
        span.setAttribute('x', number.getAttribute('x'));
        span.setAttribute('y', y + 12 + index * 28);
        span.textContent = line;
        text.append(span);
      });
      group.append(text);
    }
  }
  async function paintLive(svg) {
    await loadTimetable();
    const now = new Date();
    const result = await api(`/reservations?date=${dateKey(now)}`);
    const booked = bookingMap(result.ok ? result.data : []);
    paintPlan(svg, (no) => liveStatus({ building: PLAN_BUILDING, no }, now, booked));
  }
  function livePlan(plan, info) {
    const svg = floorSvg(plan, (room) => showRoomInfo({ ...room, building: PLAN_BUILDING }, info));
    svg.classList.add('live');
    paintLive(svg);
    return svg;
  }
  setInterval(() => document.querySelectorAll('svg.plan.live').forEach(paintLive), LIVE_REFRESH_MS);

  function weekTimetable(room) {
    const root = el('div', { className: 'week' });
    const today = new Date();
    let monday = null;
    async function draw() {
      await loadTimetable();
      monday ??= mondayOf(inTerm(today) ? today : new Date(timetable?.year ?? today.getFullYear(), (timetable?.months[0] ?? 1) - 1, 1));
      const shown = monday;
      const result = await api(`/reservations?date=${dateKey(shown)}&days=7`);
      if (shown !== monday) return;
      const rows = result.ok ? result.data.filter((row) => row.building === room.building && row.room === room.no) : [];
      const lessons = timetable?.buildings?.[room.building]?.[room.no] ?? {};
      const days = Array.from({ length: 6 }, (_, k) => addDays(shown, k)).map((date) => ({
        date,
        lessons: lessons[WEEKDAYS[date.getDay()]] ?? [],
        booked: rows.filter((row) => row.date === dateKey(date)).map((row) => row.period),
      }));
      const shift = (weeks) => () => { monday = addDays(monday, weeks * 7); draw(); };
      const last = addDays(shown, 5);
      root.replaceChildren(
        el('div', { className: 'week-nav' },
          el('button', { type: 'button', className: 'mini', textContent: '‹', ariaLabel: '이전 주', onclick: shift(-1) }),
          el('span', { textContent: `${pad(shown.getMonth() + 1)}.${pad(shown.getDate())} ~ ${pad(last.getMonth() + 1)}.${pad(last.getDate())}` }),
          el('button', { type: 'button', className: 'mini', textContent: '›', ariaLabel: '다음 주', onclick: shift(1) })),
        weekGrid(days, today));
    }
    draw();
    return root;
  }
  function showRoomInfo(room, info) {
    info.replaceChildren(
      el('h3', { textContent: `${room.no}호 ${room.name}` }),
      ...(room.en ? [el('p', { className: 'en', textContent: room.en })] : []),
      ...(room.bookable ? [
        weekTimetable(room),
        el('button', { type: 'button', className: 'primary', textContent: '사용 현황 조회', onclick: () => openReserve(room) }),
      ] : [el('p', { className: 'hint', textContent: '학생 예약 대상이 아닌 공간입니다.' })]));
  }

  // ---- 강의실 검색
  const searchForm = document.getElementById('search');
  const searchInput = searchForm.querySelector('input');
  const searchResults = document.getElementById('search-results');
  function allRooms() {
    const classrooms = Object.keys(timetable?.buildings ?? {}).flatMap(roomsOf);
    const offices = Object.entries(FLOOR_PLANS).flatMap(([key, plan]) => plan.rooms.filter((r) => !r.bookable)
      .map((r) => ({ ...r, building: PLAN_BUILDING, floor: Number(key.split('-')[1]) })));
    return [...classrooms, ...offices];
  }
  function findRooms(query) {
    const q = normalize(query);
    if (!q) return [];
    const rank = (room) => (room.no === q ? 0 : 2) + (planFor(room) ? 0 : 1);
    return allRooms().filter((room) => normalize(`${room.building}${room.no}${room.name}`).includes(q))
      .sort((a, b) => rank(a) - rank(b) || a.building.localeCompare(b.building, 'ko') || a.no.localeCompare(b.no, 'en', { numeric: true }))
      .slice(0, 8);
  }
  function closeSearch() {
    searchResults.hidden = true;
    searchResults.replaceChildren();
  }
  function openSearched(room) {
    searchInput.value = '';
    closeSearch();
    const place = map.places.find((p) => p.id === BUILDING_PLACES[room.building]);
    if (place) map.selectPlace(place);
    const plan = planFor(room);
    const title = `${room.building} ${floorLabel(room.floor)}`;
    const info = el('div', { className: 'room-info' });
    showView(backButton('건물 목록', backToLegend), el('h2', { textContent: title }), info);
    showRoomInfo(room, info);
    if (!plan) {
      info.prepend(el('p', { className: 'hint', textContent: '이 층의 평면도는 아직 등록되지 않았습니다.' }));
      return;
    }
    const svg = livePlan(plan, info);
    const target = svg.querySelector(`.room[data-room="${room.no}"]`);
    target.classList.add('located');
    svg.append(target); // 빛이 옆 호실에 가리지 않도록 맨 위에 그린다
    showStage(`${title}${plan.example ? EXAMPLE_NOTE : ''}`, svg);
  }
  searchInput.addEventListener('input', async () => {
    await loadTimetable();
    const query = searchInput.value;
    if (!normalize(query)) { closeSearch(); return; }
    const found = findRooms(query);
    searchResults.replaceChildren(...(found.length ? found.map((room) => el('li', {}, el('button', {
      type: 'button', textContent: `${room.building} ${room.no}호 ${room.name}`, onclick: () => openSearched(room),
    }))) : [el('li', { className: 'none', textContent: '검색 결과가 없습니다.' })]));
    searchResults.hidden = false;
  });
  searchForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await loadTimetable();
    const [first] = findRooms(searchInput.value);
    if (first) openSearched(first);
  });

  // ---- 빈 강의실 조회
  const page = document.getElementById('reserve');
  function periodStatus(room, date, period) {
    if (!timetable) return { unknown: true };
    const current = usedPeriods(room, date, reserved).get(period);
    return current ? { used: true, mine: current.mine, id: current.id } : { used: false };
  }
  function floorsOf(building, rooms) {
    const top = Math.max(FLOOR_COUNTS[BUILDING_PLACES[building]] ?? 1, ...rooms.map((room) => room.floor));
    const basements = [...new Set(rooms.filter((room) => room.floor < 0).map((room) => room.floor))].sort((a, b) => a - b);
    return [...basements, ...Array.from({ length: top }, (_, k) => k + 1)];
  }

  function buildReservePage(focusRoom) {
    const today = new Date();
    const select = (label, options, value) => {
      const node = el('select', { ariaLabel: label }, ...options.map(([v, text]) => el('option', { value: v, textContent: text })));
      node.value = value;
      return node;
    };
    const buildingNames = [...new Set([PLAN_BUILDING, ...Object.keys(timetable?.buildings ?? {})])].sort((a, b) => a.localeCompare(b, 'ko'));
    const building = select('호관', buildingNames.map((name) => [name, name]), focusRoom?.building ?? PLAN_BUILDING);
    const months = timetable?.months ?? Array.from({ length: 12 }, (_, k) => k + 1);
    const termYear = timetable?.year ?? today.getFullYear();
    const isToday = today.getFullYear() === termYear && months.includes(today.getMonth() + 1);
    // 챗봇 추천에서 열면 그 날짜와 공강 교시를 미리 고른다
    const start = focusRoom?.date ? new Date(`${focusRoom.date}T00:00`) : isToday ? today : new Date(termYear, months[0] - 1, 1);
    const nowPeriod = isToday ? periodAt(today.getHours() * 60 + today.getMinutes())?.no ?? 1 : 1;
    const picked = new Set(focusRoom?.periods ?? [nowPeriod]);
    const pickedPeriods = () => [...picked].sort((a, b) => a - b);
    const periodPicker = el('div', { className: 'period-grid', role: 'group', ariaLabel: '교시' }, ...PERIODS.map((p) => {
      const button = el('button', {
        type: 'button',
        onclick: () => {
          if (!picked.delete(p.no)) picked.add(p.no);
          button.classList.toggle('on', picked.has(p.no));
          button.setAttribute('aria-pressed', picked.has(p.no));
        },
      }, el('b', { textContent: `${p.no}교시` }), el('span', { textContent: `${p.start}~${p.end}` }));
      button.classList.toggle('on', picked.has(p.no));
      button.setAttribute('aria-pressed', picked.has(p.no));
      button.dataset.period = p.no;
      return button;
    }));
    const year = select('연도', [[termYear, termYear]], termYear);
    const month = select('월', months.map((m) => [m, pad(m)]), start.getMonth() + 1);
    const day = el('select', { ariaLabel: '일' });
    const fillDays = (value) => {
      const last = new Date(Number(year.value), Number(month.value), 0).getDate();
      day.replaceChildren(...Array.from({ length: last }, (_, k) => el('option', { value: k + 1, textContent: pad(k + 1) })));
      day.value = Math.min(value, last);
    };
    fillDays(start.getDate());
    year.onchange = month.onchange = () => fillDays(Number(day.value));
    const currentDate = () => new Date(Number(year.value), Number(month.value) - 1, Number(day.value));

    const center = el('div', { className: 'floor-scroll' });
    const banner = el('p', { className: 'missing', hidden: true, textContent: '수업 시간표 자료가 아직 등록되지 않아 사용 여부를 표시할 수 없습니다.' });
    const message = el('p', { className: 'status', role: 'status', hidden: true });
    let openRoom = focusRoom?.date ? roomsOf(focusRoom.building).find((room) => room.no === focusRoom.no) ?? { ...focusRoom, name: '강의실', bookable: true } : focusRoom ?? null;

    const say = (text) => { message.textContent = text; message.hidden = false; };
    async function refreshReservations(date) {
      const result = await api(`/reservations?date=${dateKey(date)}`);
      if (!result.ok) { say(result.data?.detail ?? '예약 현황을 불러오지 못했습니다.'); return; }
      reserved = bookingMap(result.data);
    }
    async function render() {
      const date = currentDate();
      await refreshReservations(date);
      banner.hidden = Boolean(timetable);
      if (openRoom) showDetail(openRoom, date);
      else showFloors(date);
    }
    function browseFloors() {
      openRoom = null;
      render();
    }
    function searchPicked() {
      if (!picked.size) { say('교시를 하나 이상 선택하세요.'); return; }
      message.hidden = true;
      browseFloors();
    }
    async function book(room, periods) {
      if (!auth.user) { say('예약하려면 오른쪽 위에서 로그인하세요.'); auth.open('login', '예약하려면 로그인하세요.'); return; }
      const result = await api('/reservations', 'POST', { building: room.building, room: room.no, date: dateKey(currentDate()), periods });
      say(result.ok ? `${room.building} ${room.no} ${periods.join(', ')}교시를 예약했습니다.` : result.data?.detail ?? '예약하지 못했습니다.');
      await render();
    }
    async function cancelBooking(id) {
      const result = await api(`/reservations/${id}`, 'DELETE');
      say(result.ok ? '예약을 취소했습니다.' : result.data?.detail ?? '취소하지 못했습니다.');
      await render();
    }

    function showDetail(room, date) {
      const rows = PERIODS.map((p) => {
        const status = periodStatus(room, date, p.no);
        const mark = status.unknown ? el('span', { className: 'unknown', textContent: '-' }) : el('b', { className: status.used ? 'hot' : 'ice', textContent: status.used ? 'O' : 'X' });
        const action = status.mine ? el('button', { type: 'button', className: 'mini cancel', textContent: '취소', onclick: () => cancelBooking(status.id) })
          : status.used === false ? el('button', { type: 'button', className: 'mini', textContent: '예약', onclick: () => book(room, [p.no]) }) : '';
        return el('tr', { className: picked.has(p.no) ? 'picked' : '' }, el('td', { textContent: `${pad(p.no)}교시(${p.start} ~ ${p.end})` }), el('td', {}, mark), el('td', {}, action));
      });
      const free = pickedPeriods().filter((no) => periodStatus(room, date, no).used === false);
      center.replaceChildren(el('div', { className: 'detail' },
        backButton('평면도로', browseFloors),
        el('h3', { textContent: `${room.building} ${room.no} ${room.name} 정보(${year.value}년 ${pad(month.value)}월 ${pad(day.value)}일)` }),
        ...(free.length ? [el('button', { type: 'button', className: 'primary book-picked', textContent: `선택한 ${free.join(', ')}교시 한 번에 예약`, onclick: () => book(room, free) })] : []),
        el('table', {}, el('thead', {}, el('tr', {}, el('th', { textContent: '교시(시간)' }), el('th', { textContent: '사용여부(사용:O, 비사용:X)' }), el('th', { textContent: '예약' }))), el('tbody', {}, ...rows))));
      center.scrollTop = 0;
    }
    // 선택한 교시가 모두 비어 있어야 빈 강의실이다
    function selectedStatus(room, date, periods) {
      const used = usedPeriods(room, date, reserved);
      const busy = periods.filter((no) => used.has(no));
      if (!busy.length) return { busy: false };
      const spans = new Map(busy.map((no) => { const status = busyStatus(used, no); return [`${status.start}~${status.end}`, status]; }));
      const [first] = spans.values();
      const mine = busy.some((no) => used.get(no).mine);
      return { ...first, mine, locked: !mine, note: spans.size > 1 ? `${first.note} 외 ${spans.size - 1}건` : first.note };
    }
    function openDetail(room) {
      openRoom = room;
      render();
    }
    function roomChip(room, date, periods) {
      const status = selectedStatus(room, date, periods);
      return el('button', {
        type: 'button', className: `room-chip${status.busy ? ' busy' : ''}`, disabled: Boolean(status.locked), onclick: () => openDetail(room),
      }, el('b', { textContent: room.no }), ...(status.busy ? [el('span', { textContent: `${status.start}~${status.end}` }), el('span', { textContent: status.note })] : []));
    }
    function floorSection(name, floor, rooms, date, periods) {
      const plan = FLOOR_PLANS[`${BUILDING_PLACES[name]}-${floor}`];
      const here = rooms.filter((room) => room.floor === floor);
      const heading = el('h3', { textContent: `${floorLabel(floor)}${plan?.example ? EXAMPLE_NOTE : ''}` });
      if (plan) {
        const svg = floorSvg(plan, (planRoom) => openDetail(here.find((room) => room.no === planRoom.no)));
        svg.querySelectorAll('.room.office').forEach((node) => node.classList.add('locked'));
        paintPlan(svg, (number) => { const room = here.find((r) => r.no === number); return room && selectedStatus(room, date, periods); });
        return el('section', { className: 'floor-section', id: `floor-${floor}` }, heading, svg);
      }
      if (!here.length) return el('section', { className: 'floor-section' }, heading, el('p', { className: 'placeholder', textContent: '등록된 강의실이 없습니다.' }));
      return el('section', { className: 'floor-section' }, heading,
        el('p', { className: 'hint', textContent: '평면도 미등록 층으로, 호실 순서대로만 표시합니다.' }),
        el('div', { className: 'room-chips' }, ...here.map((room) => roomChip(room, date, periods))));
    }
    function showFloors(date) {
      const name = building.value, periods = pickedPeriods(), rooms = roomsOf(name), top = center.scrollTop;
      center.replaceChildren(...floorsOf(name, rooms).map((floor) => floorSection(name, floor, rooms, date, periods)));
      center.scrollTop = top;
    }

    const form = el('div', { className: 'form' },
      el('label', {}, '호관(위치)', building),
      el('div', { className: 'date-label' }, '교시(시간) · 여러 개 선택 가능', periodPicker),
      el('div', { className: 'date-label' }, '날짜', el('div', { className: 'date-row' }, year, ' 년 ', month, ' 월 ', day, ' 일')),
      el('button', { type: 'button', className: 'search', textContent: '조회', onclick: searchPicked }));
    const column = (caption, ...content) => el('section', { className: 'column' }, el('p', { className: 'caption', textContent: caption }), ...content);

    page.replaceChildren(
      el('header', {}, el('button', { type: 'button', className: 'back', textContent: '← 지도로', onclick: closeReserve }), el('h2', { textContent: '빈 강의실 조회' })),
      banner,
      message,
      el('div', { className: 'columns' },
        column('원하는 건물의 사용할 시간을 설정하고 조회하기!',
          el('p', { className: 'note red', textContent: '※ 수업(학부, 대학원), 교육시설 사용 승인을 득한 자료를 기준으로 합니다.' }),
          el('p', { className: 'note blue', textContent: '※ 각 학부(과)전공 사정에 따라 강의실 운영이 달라질 수 있으므로 전공사무실에 문의하시기 바랍니다.' }),
          ...(timetable ? [el('p', { className: 'note', textContent: `※ ${timetable.source} 자료로 계산하며 휴강·보강·시험·공휴일은 반영되지 않습니다.` })] : []),
          form),
        column('층별 평면도에서 사용할 강의실을 눌러 주세요 (빨간색은 사용 중)', center)));

    rerenderReserve = render;
    building.onchange = browseFloors;
    render();
  }
  let reserveRequest = 0;
  const setSection = (section) => navButtons.forEach((other) => other.classList.toggle('on', other.dataset.section === section));
  async function openReserve(focusRoom) {
    const request = ++reserveRequest;
    setSection('reserve');
    await Promise.all([loadTimetable(), auth.ready]);
    if (request !== reserveRequest) return; // 기다리는 사이 다른 탭으로 옮겼다
    buildReservePage(focusRoom);
    page.hidden = false;
    document.body.classList.add('overlay-open');
    page.scrollTop = 0;
  }
  function closeReserve() {
    reserveRequest++;
    setSection('map');
    page.hidden = true;
    document.body.classList.remove('overlay-open');
  }
  document.getElementById('reserve-open').addEventListener('click', () => openReserve());

  // ---- 지도 위 메뉴
  let noteTimer = 0;
  for (const button of quickButtons) {
    button.addEventListener('click', () => {
      const id = button.dataset.id, active = button.classList.contains('on');
      quickNote.hidden = true;
      if (!QUICK_READY.has(id)) {
        quickNote.textContent = `${button.textContent.trim()} 메뉴는 준비 중입니다.`;
        quickNote.hidden = false;
        clearTimeout(noteTimer);
        noteTimer = setTimeout(() => { quickNote.hidden = true; }, 2200);
        return;
      }
      if (active) {
        backToLegend();
      } else if (id === 'cafe') {
        setQuick('cafe');
        map.goHome();
        map.setGlow(CAFES.map((cafe) => cafe.placeId));
        showCafe();
      } else {
        map.selectPlace(map.places.find((p) => p.id === 10));
        setQuick('study');
        map.setGlow([10]);
      }
    });
  }

  // ---- 상단 메뉴
  const faculty = initFaculty({ el, api, floorSvg: livePlan });
  const goTo = (section) => navButtons.find((button) => button.dataset.section === section).click();
  const toReserve = (overlay) => (room) => { overlay.setOpen(false); openReserve(room); };
  const chat = initChat({ el, api, openRoom: (room) => toReserve(chat)(room), openMe: () => goTo('me') });
  const me = initMe({ el, api, auth, openReserve: (room) => toReserve(me)(room) });
  auth.onChange(() => { if (!page.hidden) rerenderReserve?.(); });
  const shuttle = initShuttle({ el, showStop: () => {
    goTo('map');
    map.selectPlace(map.places.find((place) => place.id === BUS_STOP_ID));
  } });
  const navButtons = [...document.querySelectorAll('#site-nav button[data-section]')];
  for (const button of navButtons) {
    button.addEventListener('click', () => {
      closeReserve();
      faculty.setOpen(button.dataset.section === 'faculty');
      shuttle.setOpen(button.dataset.section === 'shuttle');
      chat.setOpen(button.dataset.section === 'chat');
      me.setOpen(button.dataset.section === 'me');
      setSection(button.dataset.section);
      if (button.dataset.section === 'reserve') openReserve();
    });
  }
  document.querySelector('#site-title button').addEventListener('click', () => {
    closeReserve();
    faculty.setOpen(false);
    shuttle.setOpen(false);
    chat.setOpen(false);
    me.setOpen(false);
    searchInput.value = '';
    closeSearch();
    backToLegend();
    map.goHome();
    window.scrollTo(0, 0);
  });

  return {
    onPlaceSelected(place) {
      setQuick(null);
      map.setGlow([]);
      showBuilding(place);
    },
    showLegend: backToLegend,
  };
}
