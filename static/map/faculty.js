import { COLLEGES, FLOOR_PLANS, READY_DEPARTMENTS } from './campus-data.js';
import { mondayOf, weekGrid } from './week-grid.js';

const PLAN_PLACE_IDS = { 이공관: 10 };
const WEEK_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function initFaculty({ el, api, floorSvg }) {
  const page = document.getElementById('faculty');
  const sidebar = el('nav', { className: 'colleges', ariaLabel: '단과대학' });
  const content = el('div', { className: 'faculty-content' });
  page.append(sidebar, content);

  let openCollege = null;
  let openDepartment = null;

  const notice = (text) => content.replaceChildren(el('p', { className: 'empty', textContent: text }));
  function renderSidebar() {
    sidebar.replaceChildren(...COLLEGES.map((college) => {
      const open = college.name === openCollege;
      return el('div', {},
        el('button', { type: 'button', className: `college${open ? ' on' : ''}`, textContent: college.name, onclick: () => selectCollege(college) }),
        ...(open && college.departments.length ? [el('ul', {}, ...college.departments.map((name) => el('li', {}, el('button', {
          type: 'button', className: name === openDepartment ? 'on' : '', textContent: name, onclick: () => selectDepartment(name),
        }))))] : []));
    }));
  }
  function selectCollege(college) {
    openCollege = college.name;
    openDepartment = null;
    renderSidebar();
    notice(college.departments.length ? '학과를 선택하세요.' : `${college.name} 정보는 준비 중입니다.`);
  }
  function selectDepartment(name) {
    openDepartment = name;
    renderSidebar();
    if (READY_DEPARTMENTS.includes(name)) showProfessors();
    else notice(`${name} 정보는 준비 중입니다.`);
  }

  const line = (label, value) => el('span', { className: 'line' }, el('b', { textContent: label }), ` : ${value}`);
  const office = (p) => `${p.building}${p.floor}층${p.room}호`;
  function statusLine(p) {
    return el('span', { className: 'line' }, el('b', { textContent: '상담' }), ' : ',
      el('span', { className: `lamp ${p.available ? 'green' : 'red'}` }), p.available ? '상담 가능' : '상담 불가');
  }
  function professorBody(p) {
    return [
      el('img', { src: `/static/map/professors/${p.photo}`, alt: `${p.name} 교수 사진` }),
      el('span', { className: 'professor-info' },
        el('span', { className: 'professor-name', textContent: `${p.name}(${p.english_name}) 교수` }),
        line('소속', `${openCollege} ${p.department}`),
        line('내선', p.extension),
        line('연구실', office(p)),
        line('E-mail', p.email),
        statusLine(p)),
    ];
  }

  // 폰에서는 긴 단과대학 목록 아래에 내용이 있어 맨 위로 옮겨 보여 준다
  function toContentTop() {
    content.scrollTop = 0;
    content.scrollIntoView({ block: 'start' });
  }
  async function showProfessors() {
    const department = openDepartment;
    const result = await api(`/professors?department=${encodeURIComponent(department)}`);
    if (department !== openDepartment) return;
    if (!result.ok) { notice('교수 정보를 불러오지 못했습니다.'); return; }
    content.replaceChildren(
      el('h2', { textContent: department }),
      el('div', { className: 'professors' }, ...result.data.map((p) => el('button', {
        type: 'button', className: 'professor', onclick: () => showProfessor(p),
      }, ...professorBody(p)))));
    toContentTop();
  }
  function professorTimetable(p) {
    const today = new Date(), monday = mondayOf(today);
    const days = WEEK_KEYS.map((key, k) => ({
      date: new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + k),
      lessons: p.timetable.filter(([day]) => day === key).map(([, from, to, title, place]) => [from, to, title, place.replace(/\d+층(\d+)호$/, ' $1')]),
      booked: [],
    }));
    return el('aside', { className: 'professor-timetable' }, el('h3', { textContent: `${p.name} 교수 시간표` }), weekGrid(days, today));
  }
  function showProfessor(p) {
    const show = (...below) => content.replaceChildren(
      el('button', { type: 'button', className: 'back', textContent: `← ${p.department}`, onclick: showProfessors }),
      el('div', { className: 'professor-detail' },
        el('div', {}, el('div', { className: 'professor selected' }, ...professorBody(p)), ...below),
        professorTimetable(p)));
    toContentTop();
    const plan = FLOOR_PLANS[`${PLAN_PLACE_IDS[p.building]}-${p.floor}`];
    if (!plan) {
      show(el('p', { className: 'empty', textContent: `${p.building} ${p.floor}층 평면도는 아직 등록되지 않았습니다. 연구실 위치: ${office(p)}` }));
      return;
    }
    const info = el('div', { className: 'room-info' });
    const svg = floorSvg(plan, info);
    const target = svg.querySelector(`.room[data-room="${p.room}"]`);
    target.classList.add('located');
    svg.append(target); // 빛이 옆 호실에 가리지 않도록 맨 위에 그린다
    show(el('h3', { className: 'plan-title', textContent: `${p.building} ${p.floor}층 ${plan.example ? '예시 ' : ''}평면도 · ${p.room}호` }), svg, info);
  }

  renderSidebar();
  notice('단과대학을 선택하세요.');

  return {
    setOpen(open) {
      page.hidden = !open;
      if (open) document.body.classList.add('overlay-open');
      if (open && openDepartment && READY_DEPARTMENTS.includes(openDepartment)) showProfessors();
    },
  };
}
