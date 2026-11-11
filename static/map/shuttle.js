import { SHUTTLE_ROUTES, SHUTTLE_SOURCE } from './campus-data.js';

const SCHOOL = '학교';
// '8:00 2대' → { text: '8:00', note: '2대', minutes: 480 }
function parseTime(value) {
  const [, hours, minutes, note] = value.match(/^(\d+):(\d\d)\s*(.*)$/);
  return { text: `${hours}:${minutes}`, note, minutes: Number(hours) * 60 + Number(minutes) };
}
const nowMinutes = () => { const now = new Date(); return now.getHours() * 60 + now.getMinutes(); };
// 오늘 지금 이후 학교에서 출발하는 하교 버스, 시간순
export function upcomingDepartures() {
  const now = nowMinutes();
  return SHUTTLE_ROUTES.flatMap((route) => route.fromSchool.map((time) => ({ route: route.name, ...parseTime(time) })))
    .filter((bus) => bus.minutes >= now).sort((a, b) => a.minutes - b.minutes);
}
const waitText = (minutes) => minutes < 60 ? `${minutes}분 후` : `${Math.floor(minutes / 60)}시간 ${minutes % 60}분 후`;

export function initShuttle({ el, showStop }) {
  const page = document.getElementById('shuttle');
  const list = el('nav', { className: 'routes', ariaLabel: '노선' });
  const content = el('div', { className: 'route-detail' });
  page.append(list, content);

  let openRoute = SHUTTLE_ROUTES[0];
  let timer = 0;

  // 노선에서 지금 이후 가장 먼저 출발하는 버스
  function nextBus(route) {
    const now = nowMinutes();
    const coming = [
      ...route.toSchool.map((time) => ({ ...parseTime(time), label: '등교' })),
      ...route.fromSchool.map((time) => ({ ...parseTime(time), label: '하교' })),
    ].filter((bus) => bus.minutes >= now).sort((a, b) => a.minutes - b.minutes);
    return coming[0] ?? null;
  }
  function renderList() {
    list.replaceChildren(...SHUTTLE_ROUTES.map((route) => {
      const next = nextBus(route);
      return el('button', { type: 'button', className: route === openRoute ? 'on' : '', onclick: () => { openRoute = route; render(); } },
        el('b', { textContent: route.name }),
        el('span', { textContent: next ? `${next.label} ${next.text}` : '오늘 운행 끝' }));
    }));
  }

  function direction(title, times) {
    const now = nowMinutes();
    const buses = times.map(parseTime);
    const next = buses.find((bus) => bus.minutes >= now);
    return el('section', { className: 'direction' },
      el('h3', {}, title, el('span', { className: 'next', textContent: next ? `다음 ${next.text} · ${waitText(next.minutes - now)}` : '오늘 운행 끝' })),
      el('div', { className: 'times' }, ...buses.map((bus) => el('span', {
        className: `time${bus === next ? ' next' : bus.minutes < now ? ' past' : ''}`,
      }, bus.text, ...(bus.note ? [el('small', { textContent: bus.note })] : [])))));
  }
  function stops(route) {
    const steps = [...route.stops.map((stop, k) => ({ ...stop, kind: k ? '경유' : '출발' })), { name: '협성대학교', kind: '도착' }];
    return el('section', { className: 'stops' },
      el('h3', { textContent: `${route.name} → ${SCHOOL} 승차 위치` }),
      el('ol', {}, ...steps.map((step) => el('li', { className: step.kind === '도착' ? 'end' : '' },
        el('b', {}, el('span', { className: 'kind', textContent: step.kind }), step.name),
        ...(step.where ? [el('p', { textContent: step.where })] : [])))));
  }
  function render() {
    renderList();
    const route = openRoute;
    content.replaceChildren(
      el('h2', { textContent: `${route.name} 노선` }),
      el('div', { className: 'directions' },
        direction(`${route.name} → ${SCHOOL}`, route.toSchool),
        ...(route.fromSchool.length ? [direction(`${SCHOOL} → ${route.name}`, route.fromSchool)] : [])),
      ...(route.fromSchool.length ? [] : [el('p', { className: 'hint', textContent: '학교에서 출발하는 하교 버스는 없습니다.' })]),
      stops(route),
      el('div', { className: 'shuttle-foot' },
        el('button', { type: 'button', className: 'primary', textContent: '학교 버스승강장 지도에서 보기', onclick: showStop }),
        el('p', { className: 'hint', textContent: `출처: ${SHUTTLE_SOURCE}` })));
  }

  return {
    setOpen(open) {
      page.hidden = !open;
      clearInterval(timer);
      if (!open) return;
      document.body.classList.add('overlay-open');
      render();
      timer = setInterval(render, 30000); // 다음 버스 표시를 시간에 맞춰 갱신
    },
  };
}
