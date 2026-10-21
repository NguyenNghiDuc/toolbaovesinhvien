const $ = s => document.querySelector(s);
const view = $('#view');
let user, token, page = 'dashboard';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const field = (name, label, type = 'text', extra = '') => `<label>${label}<input name="${name}" type="${type}" ${extra}></label>`;
const check = (name, label) => `<label class="check"><input name="${name}" type="checkbox">${label}</label>`;
const btn = text => `<button class="primary" type="submit">${text}</button>`;
function toast(message) { $('#toast').textContent = message; $('#toast').style.display = 'block'; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').style.display = 'none', 7000); }
async function csrf() { token = (await (await fetch('/api/csrf')).json()).token; }
async function api(path, method = 'GET', body) {
  if (!token) await csrf();
  const response = await fetch(`/api${path}`, { method, headers: { 'Content-Type': 'application/json', 'x-csrf-token': token }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Yêu cầu thất bại');
  return data;
}
function form(id, action) {
  $(id).addEventListener('submit', async e => {
    e.preventDefault(); const button = e.target.querySelector('button[type=submit]'); if (button) button.disabled = true;
    const data = Object.fromEntries(new FormData(e.target));
    for (const checkbox of e.target.querySelectorAll('input[type=checkbox]')) data[checkbox.name] = checkbox.checked;
    try { await action(data); } catch (error) { toast(error.message); } finally { if (button) button.disabled = false; }
  });
}
const labels = { dashboard: '◈  Tổng quan bảo mật', accounts: '▤  Tài khoản bảo vệ', tools: '⌕  Công cụ kiểm tra', devices: '▣  Thiết bị & phiên', security: '◇  Xác thực hai bước', lessons: '▧  Học an toàn số', reports: '↗  Báo cáo', profile: '○  Hồ sơ & cài đặt', admin: '⚙  Quản trị', schools: '▥  Quản lý trường', policy: '◇  Chính sách hệ thống' };
function shell() {
  $('#identity').textContent = user ? ({shield:'◈',star:'★',leaf:'❧',moon:'☾',sun:'☀',diamond:'◇'}[user.avatar] || '◈') + ' ' + user.name : 'Chào mừng bạn'; $('#logout').hidden = !user;
  const pages = user ? Object.keys(labels).filter(p => p !== 'admin' || user.role !== 'USER').filter(p => p !== 'schools' || user.role !== 'USER').filter(p => p !== 'policy' || user.role === 'SUPER_ADMIN') : [];
  $('#nav').innerHTML = pages.map(p => `<button data-page="${p}" class="${p === page ? 'active' : ''}">${labels[p]}</button>`).join('');
  $('#nav').querySelectorAll('button').forEach(b => b.onclick = () => go(b.dataset.page));
}
function auth(mode = 'login') {
  user = null; shell(); $('#title').textContent = 'Bảo vệ thế giới số của bạn.';
  const titles = { login: 'Chào mừng trở lại', register: 'Bắt đầu hành trình an toàn', forgot: 'Khôi phục tài khoản', resend: 'Gửi lại email xác minh' };
  view.innerHTML = `<div class="card hero"><span class="tag">STUDENTSHIELD 4.0</span><h2>Một nơi cho mọi lớp bảo vệ.</h2><p>Quản lý tài khoản, kiểm soát thiết bị và xây dựng thói quen an toàn số.</p></div><div class="card auth"><div class="tabs"><button data-mode="login">Đăng nhập</button><button data-mode="register">Đăng ký</button><button data-mode="forgot">Quên mật khẩu</button><button data-mode="resend">Xác minh email</button></div><h2>${titles[mode]}</h2><form class="form" id="auth">${mode === 'register' ? field('name', 'Họ và tên', 'text', 'required maxlength="100" autocomplete="name"') : ''}${field('email', 'Email', 'email', 'required autocomplete="email"')}${['login', 'register'].includes(mode) ? field('password', 'Mật khẩu (12–128 ký tự)', 'password', `required minlength="12" maxlength="128" autocomplete="${mode === 'register' ? 'new-password' : 'current-password'}"`) : ''}${mode === 'login' ? field('code', 'Mã 2FA hoặc mã khôi phục (nếu đã bật)', 'text', 'autocomplete="one-time-code"') : ''}${mode === 'register' ? field('schoolCode', 'Mã trường (không bắt buộc)') : ''}${btn(mode === 'login' ? 'Đăng nhập an toàn →' : 'Tiếp tục →')}</form></div>`;
  view.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => auth(b.dataset.mode));
  form('#auth', async data => { const result = await api(`/auth/${mode}`, 'POST', data); if (result.user) { user = result.user; await csrf(); await go('dashboard'); } else toast(result.message); });
}
async function go(next = page) {
  page = next; shell(); $('#title').textContent = labels[page]?.slice(3) || 'StudentShield';
  try { await screens[page](); } catch (error) { toast(error.message); }
}
const screens = {
  async dashboard() {
    const d = await api('/dashboard');
    view.innerHTML = `<div class="card hero"><span class="tag">TRUNG TÂM BẢO MẬT</span><h2>Chào ${esc(user.name)}, chủ động bảo vệ hôm nay.</h2><p>Mỗi lớp bảo vệ giúp bạn tiến thêm một bước tới không gian số an toàn.</p></div><div class="grid"><div class="card"><span class="muted">Điểm an toàn tài khoản</span><div class="metric">${d.score}<small> / 100</small></div><span class="muted">Dựa trên cài đặt và thông tin bạn khai báo</span></div><div class="card"><span class="muted">Tài khoản đang bảo vệ</span><div class="metric">${d.accounts.length}</div><span class="good">${d.accounts.filter(a => a.has2fa).length} tài khoản đã bật 2FA</span></div><div class="card"><span class="muted">Xác thực hai bước</span><div class="metric">${user.twoFactor ? 'Đã bật' : 'Chưa bật'}</div><span class="muted">Cho tài khoản StudentShield</span></div></div><div class="two"><div class="card"><h2>Việc nên làm tiếp theo</h2>${d.recommendations.map(r => `<div class="row"><span>◇ ${esc(r)}</span></div>`).join('') || '<p class="good">Bạn đã hoàn thành các bước hiện có.</p>'}</div><div class="card"><h2>Hoạt động gần đây</h2>${d.events.slice(0, 6).map(e => `<div class="row"><div>${esc(e.type)}<div class="muted">${new Date(e.createdAt).toLocaleString('vi-VN')}</div></div><span class="tag">${esc(e.ip)}</span></div>`).join('') || '<p>Chưa có hoạt động.</p>'}</div></div>`;
  },
  async accounts() {
    const list = await api('/accounts');
    view.innerHTML = `<div class="two"><div class="card"><h2>Danh sách tài khoản</h2><p>Chỉ lưu thông tin đánh giá. Không nhập mật khẩu tài khoản bên ngoài.</p>${list.map(a => `<div class="row"><div><h3>${esc(a.label)}</h3><span class="muted">${esc(a.email)}</span><div><label class="check"><input data-flag="has2fa" data-account="${a.id}" type="checkbox" ${a.has2fa ? 'checked' : ''}>2FA</label><label class="check"><input data-flag="uniquePassword" data-account="${a.id}" type="checkbox" ${a.uniquePassword ? 'checked' : ''}>Mật khẩu riêng</label><label class="check"><input data-flag="recoveryReady" data-account="${a.id}" type="checkbox" ${a.recoveryReady ? 'checked' : ''}>Sẵn sàng khôi phục</label></div></div><button data-delete="${esc(a.id)}">Xóa</button></div>`).join('') || '<p class="empty">Thêm tài khoản đầu tiên để bắt đầu đánh giá.</p>'}</div><div class="card"><h2>Thêm tài khoản cần bảo vệ</h2><form id="account" class="form">${field('label', 'Dịch vụ / tên tài khoản', 'text', 'required maxlength="100"')}${field('email', 'Email tài khoản', 'email', 'required')}${check('has2fa', 'Đã bật xác thực hai bước')}${check('uniquePassword', 'Dùng mật khẩu riêng, không tái sử dụng')}${check('recoveryReady', 'Đã thiết lập phương án khôi phục')}${btn('Thêm tài khoản')}</form></div></div>`;
    view.querySelectorAll('[data-flag]').forEach(c => c.onchange = async () => { try { await api('/accounts/' + c.dataset.account, 'PATCH', { [c.dataset.flag]: c.checked }); toast('Đã cập nhật trạng thái'); } catch (e) { c.checked = !c.checked; toast(e.message); } });
    form('#account', async data => { await api('/accounts', 'POST', data); await go(); });
    view.querySelectorAll('[data-delete]').forEach(b => b.onclick = async () => { try { await api(`/accounts/${b.dataset.delete}`, 'DELETE'); await go(); } catch (e) { toast(e.message); } });
  },
  async tools() {
    view.innerHTML = `<div class="two"><div class="card"><h2>Kiểm tra dấu hiệu phishing</h2><p>Phân tích cấu trúc URL mà không mở liên kết.</p><form id="link" class="form">${field('url', 'Liên kết cần kiểm tra', 'url', 'required')}${btn('Phân tích liên kết')}</form><div id="linkResult"></div></div><div class="card"><h2>Kiểm tra mật khẩu cục bộ</h2><p>Mật khẩu nhập ở đây chỉ được xử lý trong trình duyệt, không gửi lên máy chủ. Không dùng mật khẩu thật nếu bạn không tin cậy thiết bị.</p>${field('localPassword', 'Mật khẩu mẫu', 'password', 'autocomplete="off" maxlength="128"')}<p id="passwordResult">Ưu tiên mật khẩu dài, riêng biệt cho từng tài khoản.</p></div></div>`;
    form('#link', async data => { const r = await api('/tools/link', 'POST', data); $('#linkResult').innerHTML = `<h3>${esc(r.risk)}</h3><p>${esc(r.host)}</p>${r.flags.map(f => `<p>◇ ${esc(f)}</p>`).join('')}<p class="muted">${esc(r.note)}</p>`; });
    $('[name=localPassword]').oninput = e => { const p = e.target.value; $('#passwordResult').textContent = p.length < 12 ? 'Quá ngắn: dùng ít nhất 12 ký tự.' : /^(.)\1+$|password|123456|qwerty/i.test(p) ? 'Dễ đoán: tránh mẫu phổ biến và lặp lại.' : 'Độ dài phù hợp. Công cụ này không kiểm tra rò rỉ hoặc xác nhận mật khẩu mạnh.'; };
  },
  async devices() {
    const list = await api('/sessions');
    view.innerHTML = `<div class="card"><h2>Thiết bị & phiên đăng nhập</h2><p>Thu hồi ngay phiên bạn không nhận ra.</p>${list.map(s => `<div class="row"><div><h3>${esc(s.agent || 'Thiết bị không xác định')}</h3><span class="muted">${esc(s.ip)} · Lần cuối: ${esc(s.lastSeen ? new Date(s.lastSeen).toLocaleString('vi-VN') : '')}</span>${s.current ? '<div class="good">Phiên hiện tại</div>' : ''}</div><button data-revoke="${s.id}">Thu hồi</button></div>`).join('')}</div>`;
    view.querySelectorAll('[data-revoke]').forEach(b => b.onclick = async () => { try { await api(`/sessions/${b.dataset.revoke}`, 'DELETE'); await init(); } catch (e) { toast(e.message); } });
  },
  async security() {
    view.innerHTML = `<div class="two"><div class="card"><span class="tag">${user.twoFactor ? 'ĐANG BẢO VỆ' : 'KHUYẾN NGHỊ BẬT'}</span><h2>Xác thực hai bước</h2><p>Sử dụng ứng dụng TOTP như Google Authenticator hoặc 2FAS. Lưu mã khôi phục ngoại tuyến sau khi bật.</p><form id="twofactor" class="form">${field('password', 'Mật khẩu hiện tại', 'password', 'required autocomplete="current-password"')}${user.twoFactor ? field('code', 'Mã TOTP / khôi phục', 'text', 'required') : ''}${btn(user.twoFactor ? 'Tắt 2FA' : 'Thiết lập 2FA')}</form></div><div id="setup"></div></div>`;
    form('#twofactor', async data => {
      if (user.twoFactor) { await api('/2fa/disable', 'POST', data); user = (await api('/me')).user; await go(); return; }
      const r = await api('/2fa/setup', 'POST', data);
      $('#setup').innerHTML = `<div class="card"><h2>Quét mã bằng ứng dụng xác thực</h2><img class="qr" src="${r.qr}" alt="Mã QR thiết lập 2FA"><p>Mã thủ công: <code>${esc(r.secret)}</code></p><form id="enable" class="form">${field('code', 'Mã 6 chữ số', 'text', 'required inputmode="numeric"')}${btn('Xác nhận bật 2FA')}</form></div>`;
      form('#enable', async data => { const r = await api('/2fa/enable', 'POST', data); user = (await api('/me')).user; $('#setup').innerHTML = `<div class="card"><h2>2FA đã được bật</h2><p>Lưu các mã này ngay. Mỗi mã chỉ dùng một lần và không thể xem lại.</p><pre>${r.recoveryCodes.map(esc).join('\n')}</pre></div>`; $('#twofactor').remove(); });
    });
  },
  async lessons() {
    const list = await api('/lessons');
    view.innerHTML = `<div class="card hero"><span class="tag">HỌC AN TOÀN SỐ</span><h2>Kiến thức nhỏ. Thay đổi lớn.</h2><p>Nắm vững các thói quen giúp bảo vệ tài khoản mỗi ngày.</p></div>${list.map(l => `<div class="card"><h2>${esc(l.title)}</h2><p class="lesson">${esc(l.content)}</p>${l.completions.length ? '<span class="good">✓ Đã hoàn thành</span>' : `<button data-complete="${esc(l.id)}">Đánh dấu đã học</button>`}</div>`).join('')}`;
    view.querySelectorAll('[data-complete]').forEach(b => b.onclick = async () => { try { await api(`/lessons/${b.dataset.complete}/complete`, 'POST', {}); await go(); } catch (e) { toast(e.message); } });
  },
  async reports() { view.innerHTML = '<div class="card"><h2>Báo cáo an toàn cá nhân</h2><p>Xuất thông tin tài khoản cần bảo vệ. Điểm số dựa trên dữ liệu tự khai báo.</p><div class="actions"><a href="/api/reports/pdf">↓ Tải PDF</a><a href="/api/reports/xlsx">↓ Tải Excel</a></div></div>'; },
  async profile() {
    view.innerHTML = `<div class="two"><div class="card"><h2>Hồ sơ cá nhân</h2><p>${esc(user.email)} · ${esc(user.role)}</p><form id="profile" class="form">${field('name', 'Họ và tên', 'text', `required maxlength="100" value="${esc(user.name)}"`)}<label>Ảnh đại diện<select name="avatar">${[['shield','◈ Khiên'],['star','★ Ngôi sao'],['leaf','❧ Chiếc lá'],['moon','☾ Mặt trăng'],['sun','☀ Mặt trời'],['diamond','◇ Kim cương']].map(([v,l]) => `<option value="${v}" ${user.avatar === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>${btn('Lưu hồ sơ')}</form></div><div class="card"><h2>Đổi mật khẩu</h2><form id="password" class="form">${field('currentPassword', 'Mật khẩu hiện tại', 'password', 'required autocomplete="current-password"')}${field('password', 'Mật khẩu mới', 'password', 'required minlength="12" maxlength="128" autocomplete="new-password"')}${user.twoFactor ? field('code', 'Mã 2FA / khôi phục', 'text', 'required') : ''}${btn('Đổi mật khẩu & thu hồi phiên')}</form></div></div>`;
    form('#profile', async data => { user = (await api('/profile', 'PATCH', data)).user; shell(); toast('Đã cập nhật hồ sơ'); });
    form('#password', async data => { const r = await api('/password', 'POST', data); toast(r.message); await csrf(); auth(); });
  },
  async admin() {
    const [stats, users, events, lessons] = await Promise.all([api('/admin/stats'), api('/admin/users'), api('/admin/events'), api('/admin/lessons')]);
    view.innerHTML = `<div class="grid">${[['Người dùng', stats.users], ['Đã xác minh', stats.verified], ['Đã bật 2FA', stats.twoFactor]].map(([k,v]) => `<div class="card"><span class="muted">${k}</span><div class="metric">${v}</div></div>`).join('')}</div><div class="card"><h2>Quản lý người dùng</h2><a href="/api/admin/report.xlsx">↓ Xuất báo cáo trường (Excel)</a><p>Đã hoàn thành ${stats.completions} lượt học. Hiển thị tối đa 200 người dùng trong phạm vi.</p><div class="scroll"><table><thead><tr><th>Người dùng</th><th>Vai trò</th><th>Trường</th><th>Thao tác</th></tr></thead><tbody>${users.map(u => `<tr><td>${esc(u.name)}<br><span class="muted">${esc(u.email)}</span></td><td>${esc(u.role)}</td><td>${esc(u.schoolId || '—')}</td><td>${u.id !== user.id && u.role !== 'SUPER_ADMIN' ? `<button data-edit="${esc(u.id)}">Cập nhật</button>` : '—'}</td></tr>`).join('')}</tbody></table></div></div><div id="edit"></div><div class="card"><h2>Quản lý bài học</h2>${lessons.map(l => `<div class="row"><span>${esc(l.title)}</span><div><button data-lesson-edit="${l.id}">Sửa</button> <button data-lesson-delete="${l.id}">Xóa</button></div></div>`).join('')}</div><div id="lessonEdit"></div><div class="card"><h2>Nhật ký bảo mật & quản trị</h2>${events.slice(0, 30).map(e => `<div class="row"><span>${esc(e.type)}</span><span class="muted">${new Date(e.createdAt).toLocaleString('vi-VN')}</span></div>`).join('')}</div>${user.role !== 'USER' ? `<div class="card"><h2>Thêm bài học ${user.role === 'SUPER_ADMIN' ? 'toàn hệ thống' : 'của trường'}</h2><form id="lesson" class="form">${field('title', 'Tiêu đề', 'text', 'required maxlength="120"')}<label>Nội dung<textarea name="content" required maxlength="10000"></textarea></label>${btn('Đăng bài học')}</form></div>` : ''}`;
    view.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
      const u = users.find(u => u.id === b.dataset.edit);
      $('#edit').innerHTML = `<div class="card"><h2>Cập nhật ${esc(u.email)}</h2><form id="editUser" class="form">${user.role === 'SUPER_ADMIN' ? `<label>Vai trò<select name="role"><option ${u.role === 'USER' ? 'selected' : ''}>USER</option><option ${u.role === 'ADMIN' ? 'selected' : ''}>ADMIN</option></select></label>${field('schoolId', 'ID trường (để trống nếu không có)', 'text', `value="${esc(u.schoolId || '')}"`)}` : ''}<label>Trạng thái<select name="disabled"><option value="false">Hoạt động</option><option value="true">Khóa tài khoản</option></select></label>${btn('Lưu thay đổi')}</form></div>`;
      form('#editUser', async data => { data.disabled = data.disabled === 'true'; await api(`/admin/users/${u.id}`, 'PATCH', data); await go(); });
    });
    view.querySelectorAll('[data-lesson-delete]').forEach(b => b.onclick = async () => { if (!confirm('Xóa bài học và tiến độ liên quan?')) return; try { await api('/admin/lessons/' + b.dataset.lessonDelete, 'DELETE'); await go(); } catch(e) { toast(e.message); } });
    view.querySelectorAll('[data-lesson-edit]').forEach(b => b.onclick = () => {
      const l = lessons.find(l => l.id === b.dataset.lessonEdit);
      $('#lessonEdit').innerHTML = `<div class="card"><h2>Sửa bài học</h2><form id="lessonUpdate" class="form">${field('title','Tiêu đề','text',`required maxlength="120" value="${esc(l.title)}"`)}<label>Nội dung<textarea name="content" required maxlength="10000">${esc(l.content)}</textarea></label>${btn('Lưu bài học')}</form></div>`;
      form('#lessonUpdate', async data => { await api('/admin/lessons/' + l.id, 'PATCH', data); await go(); });
    });
    if ($('#lesson')) form('#lesson', async data => { await api('/admin/lessons', 'POST', data); toast('Đã thêm bài học'); $('#lesson').reset(); });
  },
  async policy() {
    const p = await api('/admin/policy');
    view.innerHTML = `<div class="card"><h2>Chính sách bảo mật hệ thống</h2><p>Áp dụng cho mật khẩu mới và lần đăng nhập tiếp theo. Phiên đã cấp giữ thời hạn hiện tại.</p><form id="policy" class="form">${field('minPasswordLength','Độ dài mật khẩu tối thiểu (12–64)','number',`required min="12" max="64" value="${p.minPasswordLength}"`)}${field('maxFailedLogins','Số lần thất bại tối đa / 15 phút (3–20)','number',`required min="3" max="20" value="${p.maxFailedLogins}"`)}${field('sessionHours','Thời hạn phiên (1–24 giờ)','number',`required min="1" max="24" value="${p.sessionHours}"`)}${btn('Lưu chính sách')}</form></div>`;
    form('#policy',async data => { for(const k of Object.keys(data)) data[k] = Number(data[k]); await api('/admin/policy','PATCH',data); toast('Đã lưu chính sách'); });
  },
  async schools() {
    const list = await api('/admin/schools');
    view.innerHTML = `<div class="two"><div class="card"><h2>Trường trong hệ thống</h2>${list.map(s => `<div class="row"><div><h3>${esc(s.name)}</h3><span class="tag">${esc(s.code)}</span><p class="muted">ID: ${esc(s.id)}</p><button data-school="${esc(s.id)}">Cấu hình trường</button></div></div>`).join('') || '<p>Chưa có trường. Tạo trường đầu tiên để cấp phạm vi Admin.</p>'}</div>${user.role === 'SUPER_ADMIN' ? '<div class="card"><h2>Thêm trường học</h2>' : '<div class="card"><h2>Cấu hình trường</h2>'}<form id="school" class="form">${field('name', 'Tên trường', 'text', 'required maxlength="100"')}${field('code', 'Mã trường (3–20 chữ hoa, số, _ hoặc -)', 'text', 'required pattern="[A-Z0-9_\\-]{3,20}"')}${btn('Tạo trường')}</form></div></div>`;
    if (user.role !== 'SUPER_ADMIN') $('#school').hidden = true;
    form('#school', async data => { await api('/admin/schools', 'POST', data); await go(); });
    view.querySelectorAll('[data-school]').forEach(b => b.onclick = () => {
      const school = list.find(s => s.id === b.dataset.school);
      const card = $('#school').parentElement;
      card.innerHTML = `<h2>Cấu hình ${esc(school.name)}</h2><form id="schoolEdit" class="form">${field('name','Tên trường','text',`required maxlength="100" value="${esc(school.name)}"`)}${field('contactEmail','Email liên hệ','email',`value="${esc(school.contactEmail || '')}"`)}${btn('Lưu cấu hình trường')}</form>`;
      form('#schoolEdit',async data => { await api('/admin/schools/' + school.id, 'PATCH', data); await go(); });
    });
  }
};
async function init() {
  try { user = (await api('/me')).user; await go(); } catch { auth(); }
}
$('#theme').onclick = () => { document.body.classList.toggle('light'); localStorage.setItem('ss.theme', document.body.classList.contains('light') ? 'light' : 'dark'); };
if (localStorage.getItem('ss.theme') === 'light') document.body.classList.add('light');
$('#logout').onclick = async () => { try { await api('/logout', 'POST', {}); await csrf(); auth(); } catch (e) { toast(e.message); } };
async function boot() {
  await csrf();
  const params = new URLSearchParams(location.hash.slice(1));
  const verify = params.get('verify'), reset = params.get('reset');
  if (verify || reset) history.replaceState(null, '', location.pathname);
  if (verify) { try { const r = await api('/auth/verify', 'POST', { token: verify }); toast(r.message); } catch (e) { toast(e.message); } auth(); }
  else if (reset) { auth(); view.innerHTML = `<div class="card auth"><h2>Đặt lại mật khẩu</h2><form id="reset" class="form">${field('password', 'Mật khẩu mới (12–128 ký tự)', 'password', 'required minlength="12" maxlength="128" autocomplete="new-password"')}${btn('Đặt lại mật khẩu')}</form></div>`; form('#reset', async data => { const r = await api('/auth/reset', 'POST', { ...data, token: reset }); toast(r.message); auth(); }); }
  else await init();
}
boot().catch(e => toast(e.message));
