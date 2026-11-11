const SUGGESTIONS = ['목요일 공강 때 공부하고 싶어', '화요일 공강에 갈 만한 강의실 추천해줘', '오늘 공강 언제야?'];
const GREETING = '안녕하세요! "목요일 공강 때 공부하고 싶어"처럼 물어보세요. 내 정보에 등록한 시간표를 보고, 수업 사이 빈 시간에 쓸 수 있는 강의실을 앞뒤 수업과 가까운 순으로 찾아 드려요.';
const place = (lesson) => [lesson.building, lesson.room].filter(Boolean).join(' ') || '강의실 모름';

export function initChat({ el, api, openRoom, openMe }) {
  const page = document.getElementById('chat');
  const status = el('div', { className: 'chat-timetable' });
  const messages = el('div', { className: 'messages', role: 'log', ariaLive: 'polite' });
  const input = el('input', { type: 'text', placeholder: '무엇이든 물어보세요', ariaLabel: '메시지', maxLength: 1000 });
  const send = el('button', { type: 'submit', className: 'send', ariaLabel: '보내기', innerHTML: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>' });
  const chips = el('div', { className: 'suggestions' }, ...SUGGESTIONS.map((text) => el('button', { type: 'button', textContent: text, onclick: () => ask(text) })));
  const form = el('form', { className: 'composer', onsubmit: (event) => { event.preventDefault(); ask(input.value); } }, input, send);
  page.append(el('section', { className: 'chat-box' },
    el('header', {}, el('h2', { textContent: 'AI 챗봇' }), el('span', { textContent: 'Gemini · 강의실 계산은 학교 시간표 기준' }), status),
    messages, chips, form));

  const history = [];

  function renderStatus(lessons) {
    status.replaceChildren(
      el('span', { textContent: lessons.length ? `내 시간표 수업 ${lessons.length}개` : '등록된 시간표 없음' }),
      el('button', { type: 'button', className: 'mini', textContent: lessons.length ? '내 정보에서 수정' : '내 정보에서 등록', onclick: openMe }));
  }

  // ---- 대화
  function bubble(role, ...content) {
    const node = el('div', { className: `bubble ${role}` }, ...content);
    messages.append(node);
    messages.scrollTop = messages.scrollHeight;
    return node;
  }
  function planCards(plan) {
    const day = `${plan.day_name}요일(${plan.date.slice(5).replace('-', '/')})`;
    if (!plan.lessons.length) return el('p', { className: 'plan-note', textContent: `${day}에는 등록된 수업이 없습니다.` });
    if (!plan.gaps.length) return el('p', { className: 'plan-note', textContent: `${day}에는 수업 사이 공강이 없습니다.` });
    return el('div', { className: 'plan-cards' }, ...plan.gaps.map((gap) => el('section', { className: 'gap-card' },
      el('h3', {}, `${day} ${gap.time}`, el('span', { textContent: `${gap.start === gap.end ? gap.start : `${gap.start}~${gap.end}`}교시 공강` })),
      el('p', { className: 'route', textContent: `${gap.previous.title} (${place(gap.previous)}) → ? → ${gap.next.title} (${place(gap.next)})` }),
      ...(gap.rooms.length ? gap.rooms.map((room, rank) => el('div', { className: 'pick' },
        el('b', { className: 'rank', textContent: rank + 1 }),
        el('span', { className: 'pick-info' },
          el('strong', { textContent: `${room.building} ${room.room}호` }),
          el('small', { textContent: `약 ${room.meters} m · 앞 수업에서 ${room.from_previous} · 다음 수업까지 ${room.to_next}` })),
        el('button', { type: 'button', className: 'mini', textContent: '예약하기', onclick: () => openRoom({ building: room.building, no: room.room, floor: room.floor, date: plan.date, periods: gap.periods }) })))
        : [el('p', { className: 'plan-note', textContent: '이 시간에 비어 있는 강의실이 없습니다.' })]))));
  }
  async function ask(text) {
    const message = text.trim();
    if (!message || send.disabled) return;
    input.value = '';
    chips.hidden = true;
    bubble('user', message);
    const waiting = bubble('bot typing', el('span'), el('span'), el('span'));
    send.disabled = true;
    const result = await api('/chat', 'POST', { message, history });
    send.disabled = false;
    waiting.remove();
    if (!result.ok) { bubble('bot error', result.data?.detail ?? '답변을 받지 못했습니다.'); return; }
    const { reply, plan } = result.data;
    bubble('bot', el('p', { textContent: reply || '답변이 비어 있습니다. 다시 물어봐 주세요.' }), ...(plan ? [planCards(plan)] : []));
    history.push({ role: 'user', text: message }, { role: 'model', text: reply });
    input.focus();
  }

  bubble('bot', el('p', { textContent: GREETING }));

  return {
    async setOpen(open) {
      page.hidden = !open;
      if (!open) return;
      document.body.classList.add('overlay-open');
      const result = await api('/my-timetable');
      renderStatus(result.data?.lessons ?? []);
    },
  };
}
