import { PERIODS } from './campus-data.js';

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
const COLORS = ['#f2808a', '#f5a35c', '#e0b93a', '#7dbb5b', '#4fb7a5', '#5aa6e0', '#7f8fe6', '#b083dd', '#e58ac0'];
const GRID_START = 9 * 60;
const MIN_GRID_END = 18 * 60;

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const colorOf = (title) => COLORS[[...title].reduce((sum, ch) => sum + ch.codePointAt(0), 0) % COLORS.length];

export function mondayOf(date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
  return monday;
}

// 연속된 교시를 하나의 예약 블록으로 묶는다
function bookingRanges(periods) {
  const ranges = [];
  for (const period of [...periods].sort((a, b) => a - b)) {
    const last = ranges.at(-1);
    if (last && last[1] === period - 1) last[1] = period;
    else ranges.push([period, period]);
  }
  return ranges;
}

function block(from, to, title, className, color, place) {
  const start = PERIODS[from - 1], end = PERIODS[to - 1];
  const node = el('div', { className: `week-block ${className}` },
    el('b', { textContent: title }), el('span', { textContent: place ?? `${start.start}~${end.end}` }));
  node.title = `${title} ${start.start}~${end.end}${place ? ` ${place}` : ''}`;
  node.style.top = `calc(var(--hour-height) * ${(start.startMin - GRID_START) / 60})`;
  node.style.height = `calc(var(--hour-height) * ${(end.endMin - start.startMin) / 60})`;
  if (color) node.style.background = color;
  return node;
}

// days: [{ date, lessons: [[시작 교시, 끝 교시, 과목명, 강의실(선택)]], booked: [교시] }]
export function weekGrid(days, today) {
  const shown = days.filter((day) => day.date.getDay() !== 6 || day.lessons.length || day.booked.length);
  const lastPeriods = shown.flatMap((day) => [...day.lessons.map((lesson) => lesson[1]), ...day.booked]);
  const lastMinute = Math.max(MIN_GRID_END, ...lastPeriods.map((period) => PERIODS[period - 1].endMin));
  const hours = Array.from({ length: Math.ceil((lastMinute - GRID_START) / 60) }, (_, k) => 9 + k);
  const height = `calc(var(--hour-height) * ${hours.length})`;

  const axis = el('div', { className: 'week-axis' }, ...hours.map((hour) => el('span', { textContent: hour })));
  axis.style.height = height;
  const columns = shown.map((day) => {
    const column = el('div', { className: 'week-day' },
      ...day.lessons.map(([from, to, title, place]) => block(from, to, title || '수업', 'lesson', colorOf(title || '수업'), place)),
      ...bookingRanges(day.booked).map(([from, to]) => block(from, to, '예약중', 'booked')));
    column.style.height = height;
    column.style.backgroundSize = '100% var(--hour-height)';
    return column;
  });
  const isToday = (date) => date.toDateString() === today.toDateString();
  const grid = el('div', { className: 'week-grid' },
    el('span', { className: 'week-corner' }),
    ...shown.map((day) => el('span', { className: `week-head${isToday(day.date) ? ' today' : ''}`, textContent: DAY_NAMES[day.date.getDay()] })),
    axis, ...columns);
  grid.style.gridTemplateColumns = `26px repeat(${shown.length}, minmax(0, 1fr))`;
  return grid;
}
