// 오른쪽 위 로그인·회원가입. 다른 화면은 onChange로 로그인 상태를 받는다.
export function initAuth({ el, api, box }) {
  let user = null;
  let mode = null; // null | 'login' | 'signup'
  let message = '';
  const listeners = new Set();
  const panel = el('div', { className: 'auth-panel', hidden: true });
  const bar = el('div', { className: 'auth-bar' });
  box.append(bar, panel);

  function setUser(next) {
    user = next;
    render();
    for (const listener of listeners) listener(user);
  }
  function open(next, note = '') {
    mode = next;
    message = note || (next === 'signup' ? '아이디는 영문, 숫자, _ 조합 4~20자, 비밀번호는 8자 이상입니다.' : '');
    render();
    panel.querySelector('input')?.focus();
  }
  function close() {
    mode = null;
    message = '';
    render();
  }
  function render() {
    bar.replaceChildren(...(user
      ? [el('span', { className: 'auth-user', textContent: `${user}님` }), el('button', { type: 'button', className: 'auth-light', textContent: '로그아웃', onclick: signOut })]
      : [el('button', { type: 'button', className: `auth-light${mode === 'login' ? ' on' : ''}`, textContent: '로그인', onclick: () => (mode === 'login' ? close() : open('login')) }),
        el('button', { type: 'button', className: `auth-dark${mode === 'signup' ? ' on' : ''}`, textContent: '회원가입', onclick: () => (mode === 'signup' ? close() : open('signup')) })]));
    panel.hidden = !mode || Boolean(user);
    if (panel.hidden) return;
    const signingUp = mode === 'signup';
    const id = el('input', { placeholder: '아이디', ariaLabel: '아이디', autocomplete: 'username', required: true });
    const password = el('input', { type: 'password', placeholder: '비밀번호', ariaLabel: '비밀번호', autocomplete: signingUp ? 'new-password' : 'current-password', required: true });
    const confirm = el('input', { type: 'password', placeholder: '비밀번호 확인', ariaLabel: '비밀번호 확인', autocomplete: 'new-password', required: true });
    panel.replaceChildren(el('form', { onsubmit: (event) => { event.preventDefault(); submit(id.value, password.value, confirm.value); } },
      el('h2', { textContent: signingUp ? '회원가입' : '로그인' }),
      id, password, ...(signingUp ? [confirm] : []),
      ...(message ? [el('p', { className: 'auth-message', role: 'status', textContent: message })] : []),
      el('button', { type: 'submit', className: 'primary', textContent: signingUp ? '가입하기' : '로그인' }),
      el('p', { className: 'auth-switch' }, signingUp ? '이미 계정이 있나요? ' : '처음이신가요? ',
        el('button', { type: 'button', textContent: signingUp ? '로그인' : '회원가입', onclick: () => open(signingUp ? 'login' : 'signup') }))));
  }
  async function submit(username, password, confirm) {
    if (mode === 'signup' && password !== confirm) { message = '비밀번호가 서로 다릅니다.'; render(); return; }
    const result = await api(mode === 'signup' ? '/signup' : '/login', 'POST', { username, password });
    if (!result.ok) {
      message = result.data?.detail ?? (mode === 'signup' ? '가입하지 못했습니다.' : '로그인하지 못했습니다.');
      render();
      return;
    }
    mode = null;
    message = '';
    setUser(result.data.username);
  }
  async function signOut() {
    await api('/logout', 'POST');
    setUser(null);
  }

  document.addEventListener('pointerdown', (event) => { if (mode && !box.contains(event.target)) close(); });
  document.addEventListener('keydown', (event) => { if (mode && event.key === 'Escape') close(); });
  const ready = api('/me').then((result) => setUser(result.data?.username ?? null));

  return {
    get user() { return user; },
    ready,
    open,
    onChange(listener) { listeners.add(listener); },
  };
}
