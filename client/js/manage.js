/**
 * 歯科医院予約システム - 管理画面
 */

// ===== 状態管理 =====
const state = {
    isLoggedIn: false,
    admin: null,
    currentWeek: new Date(),
    appointments: [],
    patients: [],
    selectedPatient: null
};

// ===== DOM要素 =====
const views = {
    login: document.getElementById('loginView'),
    admin: document.getElementById('adminView')
};

// ===== 初期化 =====
document.addEventListener('DOMContentLoaded', async () => {
    // セッション確認
    try {
        const admin = await api('/api/admin/me');
        state.isLoggedIn = true;
        state.admin = admin;
        showAdminView();
    } catch (error) {
        showLoginView();
    }

    setupEventListeners();
});

// ===== API通信 =====
async function api(endpoint, options = {}) {
    const response = await fetch(endpoint, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        },
        credentials: 'include'
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || 'エラーが発生しました');
    }

    return data;
}

// ===== ビュー切り替え =====
function showLoginView() {
    views.login.style.display = 'flex';
    views.admin.style.display = 'none';
}

function showAdminView() {
    views.login.style.display = 'none';
    views.admin.style.display = 'block';

    document.getElementById('adminName').textContent = state.admin.displayName;

    // 初期データ読み込み
    loadCalendar();
    loadAppointments();
    loadPatients();
    loadDoctors();
    loadServices();
    loadAccounts();
    loadSettings();
}

// ===== イベントリスナー =====
function setupEventListeners() {
    // ログインフォーム
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        try {
            const result = await api('/api/admin/login', {
                method: 'POST',
                body: JSON.stringify({ username, password })
            });

            state.isLoggedIn = true;
            state.admin = result.admin;
            showAdminView();

        } catch (error) {
            document.getElementById('loginError').textContent = error.message;
            document.getElementById('loginError').style.display = 'block';
        }
    });

    // ログアウト
    document.getElementById('logoutBtn').addEventListener('click', async () => {
        try {
            await api('/api/admin/logout', { method: 'POST' });
        } catch (error) {
            // エラーでもログアウト処理を続行
        }
        state.isLoggedIn = false;
        state.admin = null;
        showLoginView();
    });

    // タブ切り替え
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            tab.classList.add('active');
            document.getElementById(`${tab.dataset.tab}Tab`).classList.add('active');
        });
    });

    // 週ナビゲーション
    document.getElementById('prevWeek').addEventListener('click', () => {
        state.currentWeek.setDate(state.currentWeek.getDate() - 7);
        loadCalendar();
    });

    document.getElementById('nextWeek').addEventListener('click', () => {
        state.currentWeek.setDate(state.currentWeek.getDate() + 7);
        loadCalendar();
    });

    document.getElementById('todayBtn').addEventListener('click', () => {
        state.currentWeek = new Date();
        loadCalendar();
    });

    // フィルター
    document.getElementById('applyFilter').addEventListener('click', loadAppointments);

    // CSVエクスポート
    document.getElementById('exportCsv').addEventListener('click', exportCsv);

    // 患者検索
    document.getElementById('searchPatients').addEventListener('click', () => {
        loadPatients(document.getElementById('patientSearch').value);
    });

    document.getElementById('patientSearch').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            loadPatients(document.getElementById('patientSearch').value);
        }
    });

    // モーダル
    document.getElementById('closeModal').addEventListener('click', closeModal);
    document.getElementById('modalCancel').addEventListener('click', closeModal);
    // 予約詳細モーダルを閉じる
    document.getElementById('appointmentModal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('appointmentModal')) {
            closeModal();
        }
    });

    // 確認モーダルを閉じる
    document.getElementById('confirmModal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('confirmModal')) {
            document.getElementById('confirmModal').classList.remove('active');
        }
    });
    document.getElementById('confirmCancel').addEventListener('click', () => {
        document.getElementById('confirmModal').classList.remove('active');
    });

    // イベントデリゲーション
    document.addEventListener('click', (e) => {
        // カレンダーの予約ブロック
        const block = e.target.closest('.appointment-block');
        if (block) {
            const id = block.getAttribute('data-id');
            showAppointmentDetail(id);
            return;
        }

        // 予約一覧の詳細ボタン
        if (e.target.classList.contains('view-detail-btn')) {
            const id = e.target.getAttribute('data-id');
            showAppointmentDetail(id);
            return;
        }

        // 患者カード
        const patientCard = e.target.closest('.patient-card');
        if (patientCard) {
            const id = patientCard.getAttribute('data-id');
            selectPatient(id);
            return;
        }

        // 予約詳細モーダル内の患者リンク
        if (e.target.classList.contains('patient-link')) {
            e.preventDefault();
            const id = e.target.getAttribute('data-id');
            selectPatientById(id);
            closeModal();
            return;
        }

        // メモ追加ボタン
        if (e.target.classList.contains('add-note-btn')) {
            const id = e.target.getAttribute('data-id');
            addNote(id);
            return;
        }

        // 医師削除ボタン
        const deleteBtn = e.target.closest('.delete-doctor-btn');
        if (deleteBtn) {
            e.preventDefault();
            e.stopPropagation();
            const id = deleteBtn.getAttribute('data-id');
            deleteDoctor(id);
            return;
        }

        // 管理者削除ボタン
        const deleteAccountBtn = e.target.closest('.delete-account-btn');
        if (deleteAccountBtn) {
            e.preventDefault();
            const id = deleteAccountBtn.getAttribute('data-id');
            deleteAccount(id);
            return;
        }

        // メニュー削除ボタン
        const deleteServiceBtn = e.target.closest('.delete-service-btn');
        if (deleteServiceBtn) {
            e.preventDefault();
            const id = deleteServiceBtn.getAttribute('data-id');
            deleteService(id);
            return;
        }
    });

    // mousedownでの停止（ドラッグ開始を防ぐ）
    document.addEventListener('mousedown', (e) => {
        if (e.target.closest('.delete-doctor-btn')) {
            e.stopPropagation();
        }
    });
}

// ===== カレンダー =====
async function loadCalendar() {
    const startOfWeek = getStartOfWeek(state.currentWeek);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 6);

    // 週タイトル更新
    document.getElementById('weekTitle').textContent =
        `${startOfWeek.getMonth() + 1}/${startOfWeek.getDate()} - ${endOfWeek.getMonth() + 1}/${endOfWeek.getDate()}`;

    try {
        // カレンダーグリッドを読み込み中にする（オプション）
        // document.getElementById('calendarGrid').style.opacity = '0.5';

        const startStr = formatDate(startOfWeek);
        const endStr = formatDate(endOfWeek) + ' 23:59:59';

        const appointments = await api(
            `/api/admin/appointments?start=${encodeURIComponent(startStr)}&end=${encodeURIComponent(endStr)}`
        );

        renderCalendar(startOfWeek, appointments);
    } catch (error) {
        console.error('カレンダー読み込みエラー:', error);
        // エラーをユーザーに通知
        const grid = document.getElementById('calendarGrid');
        grid.innerHTML = `<div style="padding: 20px; color: red; text-align: center;">カレンダーの読み込みに失敗しました。<br>${escapeHtml(error.message)}</div>`;
    } finally {
        // document.getElementById('calendarGrid').style.opacity = '1';
    }
}

function renderCalendar(startOfWeek, appointments) {
    const grid = document.getElementById('calendarGrid');
    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];

    // ヘッダー行
    let html = '<div class="calendar-week-header time-col"></div>';
    for (let i = 0; i < 7; i++) {
        const date = new Date(startOfWeek);
        date.setDate(date.getDate() + i);
        html += `<div class="calendar-week-header">${dayNames[i]}<br>${date.getMonth() + 1}/${date.getDate()}</div>`;
    }

    // 時間行（9:00-18:00）
    for (let hour = 9; hour < 18; hour++) {
        html += `<div class="time-label">${hour}:00</div>`;

        for (let day = 0; day < 7; day++) {
            const date = new Date(startOfWeek);
            date.setDate(date.getDate() + day);
            const dateStr = formatDate(date);

            // この時間帯の予約を取得
            const hourAppointments = appointments.filter(apt => {
                const d = new Date(apt.start_at);
                const aptDate = formatDate(d);
                const aptHour = d.getHours();
                return aptDate === dateStr && aptHour === hour;
            });

            html += `<div class="time-slot" data-date="${dateStr}" data-hour="${hour}">`;
            hourAppointments.forEach(apt => {
                const d = new Date(apt.start_at);
                const startTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                html += `
                    <div class="appointment-block ${apt.status}" data-id="${apt.id}">
                        ${startTime} ${escapeHtml(apt.patient_name || apt.name || '名称未設定')}
                    </div>
                `;
            });
            html += '</div>';
        }
    }

    grid.innerHTML = html;
}

// ===== 予約一覧 =====
async function loadAppointments() {
    const dateFrom = document.getElementById('filterDateFrom').value;
    const dateTo = document.getElementById('filterDateTo').value;
    const status = document.getElementById('filterStatus').value;

    let url = '/api/admin/appointments?';
    if (dateFrom) url += `start=${dateFrom}&`;
    if (dateTo) url += `end=${dateTo} 23:59:59&`;
    if (status) url += `status=${status}&`;

    try {
        const appointments = await api(url);
        state.appointments = appointments;
        renderAppointmentsTable(appointments);
    } catch (error) {
        console.error('予約一覧読み込みエラー:', error);
    }
}

function renderAppointmentsTable(appointments) {
    const tbody = document.querySelector('#appointmentsTable tbody');

    if (appointments.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--muted);">予約がありません</td></tr>';
        return;
    }

    tbody.innerHTML = appointments.map(apt => {
        const startDate = new Date(apt.start_at);
        return `
            <tr>
                <td>#${apt.id}</td>
                <td>${formatDateTime(startDate)}</td>
                <td>${escapeHtml(apt.patient_name)}</td>
                <td>${escapeHtml(apt.service_name)}</td>
                <td>${escapeHtml(apt.staff_name || '指名なし')}</td>
                <td><span class="badge badge-${apt.status}">${getStatusLabel(apt.status)}</span></td>
                <td class="table-actions">
                    <button class="btn btn-secondary view-detail-btn" data-id="${apt.id}" style="padding: 4px 8px; font-size: 0.75rem;">詳細</button>
                </td>
            </tr>
        `;
    }).join('');
}

async function exportCsv() {
    const dateFrom = document.getElementById('filterDateFrom').value;
    const dateTo = document.getElementById('filterDateTo').value;

    let url = '/api/admin/appointments/export/csv?';
    if (dateFrom) url += `start=${dateFrom}&`;
    if (dateTo) url += `end=${dateTo}&`;

    window.location.href = url;
}

// ===== 予約詳細モーダル =====
async function showAppointmentDetail(id) {
    try {
        const apt = await api(`/api/admin/appointments/${id}`);

        const startDate = new Date(apt.start_at);

        document.getElementById('modalBody').innerHTML = `
            <div class="confirm-section">
                <div class="confirm-title">予約ID</div>
                <div class="confirm-value">#${apt.id}</div>
            </div>
            <div class="confirm-section">
                <div class="confirm-title">日時</div>
                <div class="confirm-value">${formatDateTime(startDate)}</div>
            </div>
            <div class="confirm-section">
                <div class="confirm-title">患者名</div>
                <div class="confirm-value">
                    <a href="#" class="patient-link" data-id="${apt.patient_id}" style="color: var(--accent);">
                        ${escapeHtml(apt.name)}（${escapeHtml(apt.kana)}）
                    </a>
                </div>
            </div>
            <div class="confirm-section">
                <div class="confirm-title">電話番号</div>
                <div class="confirm-value">${escapeHtml(apt.phone)}</div>
            </div>
            <div class="confirm-section">
                <div class="confirm-title">メニュー</div>
                <div class="confirm-value">${escapeHtml(apt.service_name)}</div>
            </div>
            <div class="confirm-section">
                <div class="confirm-title">担当</div>
                <div class="confirm-value">${escapeHtml(apt.staff_name || '指名なし')}</div>
            </div>
            <div class="confirm-section">
                <div class="confirm-title">ステータス</div>
                <div class="confirm-value">
                    <select id="aptStatus" class="form-input" style="width: auto;">
                        <option value="confirmed" ${apt.status === 'confirmed' ? 'selected' : ''}>予約済み</option>
                        <option value="completed" ${apt.status === 'completed' ? 'selected' : ''}>完了</option>
                        <option value="cancelled" ${apt.status === 'cancelled' ? 'selected' : ''}>キャンセル</option>
                    </select>
                </div>
            </div>
            <div class="confirm-section">
                <div class="confirm-title">メモ</div>
                <div class="confirm-value">
                    <textarea id="aptNotes" class="form-input" style="min-height: 80px;">${escapeHtml(apt.notes || '')}</textarea>
                </div>
            </div>
        `;

        document.getElementById('modalSave').style.display = 'inline-flex';
        document.getElementById('modalSave').onclick = () => updateAppointment(id);

        // 削除ボタンを表示・設定
        const deleteBtn = document.getElementById('modalDelete');
        if (deleteBtn) {
            deleteBtn.style.display = 'inline-flex';
            deleteBtn.onclick = () => deleteAppointment(id);
        }

        document.getElementById('appointmentModal').classList.add('active');

    } catch (error) {
        alert(error.message);
    }
}

async function updateAppointment(id) {
    const status = document.getElementById('aptStatus').value;
    const notes = document.getElementById('aptNotes').value;

    try {
        await api(`/api/admin/appointments/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ status, notes })
        });

        closeModal();
        loadCalendar();
        loadAppointments();

    } catch (error) {
        alert(error.message);
    }
}

function closeModal() {
    document.getElementById('appointmentModal').classList.remove('active');
}

// ===== カスタム確認ダイアログ =====
function showConfirm(title, message, okLabel = 'OK', okClass = 'btn-primary') {
    return new Promise((resolve) => {
        const modal = document.getElementById('confirmModal');
        const titleEl = document.getElementById('confirmTitle');
        const bodyEl = document.getElementById('confirmBody');
        const okBtn = document.getElementById('confirmOk');

        titleEl.textContent = title;
        bodyEl.textContent = message;
        okBtn.textContent = okLabel;

        // クラスのリセットと設定
        okBtn.className = `btn ${okClass}`;

        const handleOk = () => {
            modal.classList.remove('active');
            cleanup();
            resolve(true);
        };

        const handleCancel = () => {
            modal.classList.remove('active');
            cleanup();
            resolve(false);
        };

        const cleanup = () => {
            okBtn.removeEventListener('click', handleOk);
            document.getElementById('confirmCancel').removeEventListener('click', handleCancel);
        };

        okBtn.addEventListener('click', handleOk);
        document.getElementById('confirmCancel').addEventListener('click', handleCancel);

        modal.classList.add('active');
    });
}

// ===== 患者管理 =====
async function loadPatients(search = '') {
    try {
        const patients = await api(`/api/admin/patients${search ? `?search=${encodeURIComponent(search)}` : ''}`);
        state.patients = patients;
        renderPatientList(patients);
    } catch (error) {
        console.error('患者一覧読み込みエラー:', error);
    }
}

function renderPatientList(patients) {
    const list = document.getElementById('patientList');

    if (patients.length === 0) {
        list.innerHTML = '<div style="text-align: center; color: var(--muted); padding: 24px;">患者が見つかりません</div>';
        return;
    }

    list.innerHTML = patients.map(patient => `
        <div class="patient-card" data-id="${patient.id}">
            <div class="patient-name">${escapeHtml(patient.name)}</div>
            <div class="patient-info">
                ${escapeHtml(patient.kana)}<br>
                ${escapeHtml(patient.phone)}
                ${patient.appointment_count ? `<br>来院${patient.appointment_count}回` : ''}
            </div>
        </div>
    `).join('');
}

async function selectPatient(id) {
    try {
        const patient = await api(`/api/admin/patients/${id}`);
        state.selectedPatient = patient;
        renderPatientDetail(patient);
    } catch (error) {
        alert(error.message);
    }
}

async function selectPatientById(id) {
    // タブを切り替え
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector('.tab[data-tab="patients"]').classList.add('active');
    document.getElementById('patientsTab').classList.add('active');

    await selectPatient(id);
}

function renderPatientDetail(patient) {
    document.getElementById('patientPlaceholder').style.display = 'none';
    const detail = document.getElementById('patientDetail');
    detail.style.display = 'block';

    detail.innerHTML = `
        <div class="detail-header">
            <h3 class="detail-title">${escapeHtml(patient.name)}</h3>
        </div>
        
        <div style="margin-bottom: var(--spacing-lg);">
            <p><strong>ふりがな:</strong> ${escapeHtml(patient.kana)}</p>
            <p><strong>電話番号:</strong> ${escapeHtml(patient.phone)}</p>
            <p><strong>メール:</strong> ${escapeHtml(patient.email || '-')}</p>
            <p><strong>住所:</strong> ${escapeHtml(patient.address || '-')}</p>
            <p><strong>登録日:</strong> ${formatDateTime(new Date(patient.created_at))}</p>
        </div>
        
        <h4 style="margin-bottom: var(--spacing-md);">予約履歴</h4>
        <div style="margin-bottom: var(--spacing-lg);">
            ${patient.appointments.length === 0 ?
            '<p style="color: var(--muted);">予約履歴がありません</p>' :
            patient.appointments.slice(0, 10).map(apt => {
                const date = new Date(apt.start_at);
                return `
                        <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border);">
                            <span>${formatDateTime(date)}</span>
                            <span>${escapeHtml(apt.service_name)}</span>
                            <span class="badge badge-${apt.status}">${getStatusLabel(apt.status)}</span>
                        </div>
                    `;
            }).join('')
        }
        </div>
        
        <h4 style="margin-bottom: var(--spacing-md);">メモ（カルテ）</h4>
        <div class="note-list">
            ${patient.notes.length === 0 ?
            '<p style="color: var(--muted);">メモがありません</p>' :
            patient.notes.map(note => `
                    <div class="note-item">
                        <div class="note-meta">
                            ${formatDateTime(new Date(note.created_at))}
                            ${note.created_by_name ? ` - ${escapeHtml(note.created_by_name)}` : ''}
                        </div>
                        <div class="note-content">${escapeHtml(note.note)}</div>
                    </div>
                `).join('')
        }
        </div>
        
        <div class="add-note-form">
            <h4 style="margin-bottom: var(--spacing-sm);">メモを追加</h4>
            <textarea id="newNote" placeholder="メモを入力..."></textarea>
            <button class="btn btn-primary add-note-btn" data-id="${patient.id}">追加</button>
        </div>
    `;
}

async function addNote(patientId) {
    const note = document.getElementById('newNote').value.trim();
    if (!note) {
        alert('メモを入力してください');
        return;
    }

    try {
        await api(`/api/admin/patients/${patientId}/notes`, {
            method: 'POST',
            body: JSON.stringify({ note })
        });

        selectPatient(patientId);

    } catch (error) {
        alert(error.message);
    }
}

// ===== ユーティリティ =====
function getStartOfWeek(date) {
    const d = new Date(date);
    const day = d.getDay();
    d.setDate(d.getDate() - day);
    d.setHours(0, 0, 0, 0);
    return d;
}

function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatDateTime(date) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
    return `${year}/${month}/${day}（${dayNames[date.getDay()]}）${hours}:${minutes}`;
}

function escapeHtml(str) {
    if (!str) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(str).replace(/[&<>"']/g, char => map[char]);
}

function getStatusLabel(status) {
    const labels = {
        confirmed: '予約済み',
        cancelled: 'キャンセル',
        completed: '完了'
    };
    return labels[status] || status;
}

// グローバルに公開
window.showAppointmentDetail = showAppointmentDetail;
window.selectPatient = selectPatient;
window.selectPatientById = selectPatientById;
window.addNote = addNote;
window.deleteDoctor = deleteDoctor;

// ===== 設定 =====
async function loadSettings() {
    try {
        const settings = await api('/api/admin/settings/smtp');
        document.getElementById('smtpHost').value = settings.smtpHost || 'smtp.gmail.com';
        document.getElementById('smtpPort').value = settings.smtpPort || '587';
        document.getElementById('smtpUser').value = settings.smtpUser || '';
        document.getElementById('smtpPass').value = settings.smtpPass || '';
        document.getElementById('adminNotificationEmail').value = settings.adminNotificationEmail || '';
    } catch (error) {
        console.error('設定読み込みエラー:', error);
    }

    // 営業時間・予約設定・スケジュール例外も読み込み
    loadBusinessHours();
    loadBookingSettings();
    loadScheduleExceptions();
}

// ===== 営業時間管理 =====
const dayNames = ['日', '月', '火', '水', '木', '金', '土'];

async function loadBusinessHours() {
    try {
        const hours = await api('/api/admin/business-hours');
        renderBusinessHoursTable(hours);
    } catch (error) {
        console.error('営業時間読み込みエラー:', error);
    }
}

async function loadBookingSettings() {
    try {
        const settings = await api('/api/admin/settings/booking');
        document.getElementById('cutoffDays').value = settings.cutoffDays;
        document.getElementById('cutoffHours').value = settings.cutoffHours;
        document.getElementById('maxDaysAhead').value = settings.maxDaysAhead;
    } catch (error) {
        console.error('予約設定読み込みエラー:', error);
    }
}

document.getElementById('bookingSettingsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const data = {
        cutoffDays: parseInt(document.getElementById('cutoffDays').value),
        cutoffHours: parseInt(document.getElementById('cutoffHours').value),
        maxDaysAhead: parseInt(document.getElementById('maxDaysAhead').value)
    };

    try {
        const result = await api('/api/admin/settings/booking', {
            method: 'PUT',
            body: JSON.stringify(data)
        });

        showBookingSettingsAlert('success', result.message);
    } catch (error) {
        showBookingSettingsAlert('error', error.message);
    }
});

function showBookingSettingsAlert(type, message) {
    const alert = document.getElementById('bookingSettingsAlert');
    if (!alert) return;
    alert.className = `alert alert-${type}`;
    alert.textContent = message;
    alert.style.display = 'block';
    setTimeout(() => { alert.style.display = 'none'; }, 3000);
}

// 設定フォーム送信
document.getElementById('settingsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const smtpPass = document.getElementById('smtpPass').value;

    const data = {
        smtpHost: document.getElementById('smtpHost').value,
        smtpPort: document.getElementById('smtpPort').value,
        smtpUser: document.getElementById('smtpUser').value,
        adminNotificationEmail: document.getElementById('adminNotificationEmail').value
    };

    if (smtpPass) {
        data.smtpPass = smtpPass;
    }

    try {
        const result = await api('/api/admin/settings/smtp', {
            method: 'PUT',
            body: JSON.stringify(data)
        });

        showSettingsAlert('success', result.message);
    } catch (error) {
        showSettingsAlert('error', error.message);
    }
});

// デバッグ: 全予約削除
document.getElementById('debugClearAppointments')?.addEventListener('click', async () => {
    if (!confirm('本当に全ての予約データを削除しますか？\nこの操作は取り消せません。')) {
        return;
    }

    try {
        const result = await api('/api/admin/debug/appointments', {
            method: 'DELETE'
        });
        alert(result.message);
        // カレンダー再読み込み
        loadCalendar();
    } catch (error) {
        alert('削除エラー: ' + error.message);
    }
});

// テストメール送信
document.getElementById('testEmailBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('testEmailBtn');
    btn.disabled = true;
    btn.textContent = '送信中...';

    try {
        const result = await api('/api/admin/settings/smtp/test', {
            method: 'POST',
            body: JSON.stringify({})
        });

        showSettingsAlert('success', result.message);
    } catch (error) {
        showSettingsAlert('error', error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'テストメール送信';
    }
});

function showSettingsAlert(type, message) {
    const alert = document.getElementById('settingsAlert');
    alert.className = `alert alert-${type}`;
    alert.textContent = message;
    alert.style.display = 'block';

    setTimeout(() => {
        alert.style.display = 'none';
    }, 5000);
}

// ===== 医師（スタッフ）管理 =====
async function loadDoctors() {
    try {
        const doctors = await api('/api/admin/staff');
        renderDoctorsTable(doctors);
    } catch (error) {
        console.error('医師一覧読み込みエラー:', error);
    }
}

function renderDoctorsTable(doctors) {
    const tbody = document.querySelector('#doctorsTable tbody');

    if (doctors.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--muted);">医師が登録されていません</td></tr>';
        return;
    }

    tbody.innerHTML = doctors.map(doc => `
        <tr class="draggable-row" draggable="true" data-id="${doc.id}">
            <td style="cursor: move;">
                <span style="color: var(--muted); margin-right: 8px;">☰</span>
                ${doc.id}
            </td>
            <td>${escapeHtml(doc.name)}</td>
            <td>${escapeHtml(doc.title || '-')}</td>
            <td>
                <button class="btn btn-secondary delete-doctor-btn" data-id="${doc.id}" style="padding: 4px 8px; font-size: 0.75rem; color: #ef4444; border-color: #ef4444;">削除</button>
            </td>
        </tr>
    `).join('');

    // DnDイベント設定
    const rows = tbody.querySelectorAll('tr.draggable-row');
    rows.forEach(row => {
        row.addEventListener('dragstart', handleDragStart);
        row.addEventListener('dragover', handleDragOver);
        row.addEventListener('drop', handleDrop);
        row.addEventListener('dragend', handleDragEnd);
    });
}

document.getElementById('addDoctorForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('doctorName').value;
    const title = document.getElementById('doctorTitle').value;
    const alertBox = document.getElementById('doctorParamsAlert');

    try {
        await api('/api/admin/staff', {
            method: 'POST',
            body: JSON.stringify({ name, title })
        });

        document.getElementById('addDoctorForm').reset();
        alertBox.className = 'alert alert-success';
        alertBox.textContent = '医師を登録しました';
        alertBox.style.display = 'block';
        setTimeout(() => { alertBox.style.display = 'none'; }, 3000);

        loadDoctors();
    } catch (error) {
        alertBox.className = 'alert alert-error';
        alertBox.textContent = error.message;
        alertBox.style.display = 'block';
    }
});

async function deleteDoctor(id) {
    const confirmed = await showConfirm(
        '医師の削除',
        'この医師を削除してもよろしいですか？',
        '削除する',
        'btn-primary' // 必要に応じて btn-error などのスタイルを当てられるように
    );

    if (!confirmed) return;

    try {
        await api(`/api/admin/staff/${id}`, { method: 'DELETE' });
        loadDoctors();
    } catch (error) {
        alert(error.message);
    }
}

// ===== DnD処理 =====
let dragSrcEl = null;

function handleDragStart(e) {
    dragSrcEl = this;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', this.innerHTML);
    this.classList.add('dragging');
}

function handleDragOver(e) {
    if (e.preventDefault) {
        e.preventDefault();
    }
    e.dataTransfer.dropEffect = 'move';
    return false;
}

function handleDrop(e) {
    if (e.stopPropagation) {
        e.stopPropagation();
    }

    if (dragSrcEl !== this) {
        // 並び替え処理
        const tbody = this.parentNode;
        const rows = Array.from(tbody.querySelectorAll('tr.draggable-row'));
        const srcIndex = rows.indexOf(dragSrcEl);
        const targetIndex = rows.indexOf(this);

        if (srcIndex < targetIndex) {
            tbody.insertBefore(dragSrcEl, this.nextSibling);
        } else {
            tbody.insertBefore(dragSrcEl, this);
        }

        saveDoctorOrder();
    }

    return false;
}

function handleDragEnd(e) {
    this.classList.remove('dragging');
    const rows = document.querySelectorAll('#doctorsTable tr.draggable-row');
    rows.forEach(row => row.classList.remove('drag-over'));
}

async function saveDoctorOrder() {
    const rows = document.querySelectorAll('#doctorsTable tr.draggable-row');
    const ids = Array.from(rows).map(row => parseInt(row.dataset.id));

    try {
        await api('/api/admin/staff/reorder', {
            method: 'PUT',
            body: JSON.stringify({ ids })
        });
    } catch (error) {
        console.error('並び替え保存エラー:', error);
        alert('順序の保存に失敗しました');
    }
}

// ===== 管理者アカウント管理 =====
async function loadAccounts() {
    try {
        const accounts = await api('/api/admin/accounts');
        renderAccountsTable(accounts);
    } catch (error) {
        console.error('管理者一覧読み込みエラー:', error);
    }
}

function renderAccountsTable(accounts) {
    const tbody = document.querySelector('#accountsTable tbody');
    if (!tbody) return;

    if (accounts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--muted);">管理者が登録されていません</td></tr>';
        return;
    }

    tbody.innerHTML = accounts.map(acc => `
        <tr>
            <td>${acc.id}</td>
            <td>${escapeHtml(acc.username)}</td>
            <td>${escapeHtml(acc.display_name)}</td>
            <td>${acc.last_login_at ? formatDateTime(new Date(acc.last_login_at)) : '-'}</td>
            <td>${formatDate(new Date(acc.created_at))}</td>
            <td>
                <button class="btn btn-secondary delete-account-btn" data-id="${acc.id}" style="padding: 4px 8px; font-size: 0.75rem; color: #ef4444; border-color: #ef4444;">削除</button>
            </td>
        </tr>
    `).join('');
}

document.getElementById('addAccountForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('accountUsername').value;
    const password = document.getElementById('accountPassword').value;
    const displayName = document.getElementById('accountDisplayName').value;
    const alertBox = document.getElementById('accountAlert');

    try {
        await api('/api/admin/accounts', {
            method: 'POST',
            body: JSON.stringify({ username, password, displayName })
        });

        document.getElementById('addAccountForm').reset();
        alertBox.className = 'alert alert-success';
        alertBox.textContent = '管理者を登録しました';
        alertBox.style.display = 'block';
        setTimeout(() => { alertBox.style.display = 'none'; }, 3000);

        loadAccounts();
    } catch (error) {
        alertBox.className = 'alert alert-error';
        alertBox.textContent = error.message;
        alertBox.style.display = 'block';
    }
});

async function deleteAccount(id) {
    const confirmed = await showConfirm(
        '管理者の削除',
        'この管理者を削除してもよろしいですか？',
        '削除する',
        'btn-primary'
    );

    if (!confirmed) return;

    try {
        await api(`/api/admin/accounts/${id}`, { method: 'DELETE' });
        loadAccounts();
    } catch (error) {
        alert(error.message);
    }
}

window.deleteAccount = deleteAccount;

// ===== メニュー管理 =====
async function loadServices() {
    try {
        const services = await api('/api/admin/services');
        renderServicesTable(services);
    } catch (error) {
        console.error('メニュー一覧読み込みエラー:', error);
    }
}

function renderServicesTable(services) {
    const tbody = document.querySelector('#servicesTable tbody');
    if (!tbody) return;

    if (services.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--muted);">メニューが登録されていません</td></tr>';
        return;
    }

    tbody.innerHTML = services.map(svc => `
        <tr class="draggable-service-row" draggable="true" data-id="${svc.id}">
            <td style="cursor: move;">
                <span style="color: var(--muted); margin-right: 8px;">☰</span>
                ${svc.id}
            </td>
            <td>${escapeHtml(svc.name)}</td>
            <td>${svc.duration_minutes}分</td>
            <td>${escapeHtml(svc.description || '-')}</td>
            <td>
                <span class="badge ${svc.is_active ? 'badge-confirmed' : 'badge-cancelled'}">
                    ${svc.is_active ? '有効' : '無効'}
                </span>
            </td>
            <td class="table-actions">
                <button class="btn btn-secondary delete-service-btn" data-id="${svc.id}" style="padding: 4px 8px; font-size: 0.75rem; color: #ef4444; border-color: #ef4444;">削除</button>
            </td>
        </tr>
    `).join('');

    // DnDイベント設定
    const rows = tbody.querySelectorAll('tr.draggable-service-row');
    rows.forEach(row => {
        row.addEventListener('dragstart', handleServiceDragStart);
        row.addEventListener('dragover', handleServiceDragOver);
        row.addEventListener('drop', handleServiceDrop);
        row.addEventListener('dragend', handleServiceDragEnd);
    });
}

document.getElementById('addServiceForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('serviceName').value;
    const durationMinutes = document.getElementById('serviceDuration').value;
    const description = document.getElementById('serviceDescription').value;
    const alertBox = document.getElementById('serviceAlert');

    try {
        await api('/api/admin/services', {
            method: 'POST',
            body: JSON.stringify({ name, durationMinutes, description })
        });

        document.getElementById('addServiceForm').reset();
        alertBox.className = 'alert alert-success';
        alertBox.textContent = 'メニューを登録しました';
        alertBox.style.display = 'block';
        setTimeout(() => { alertBox.style.display = 'none'; }, 3000);

        loadServices();
    } catch (error) {
        alertBox.className = 'alert alert-error';
        alertBox.textContent = error.message;
        alertBox.style.display = 'block';
    }
});

async function deleteService(id) {
    const confirmed = await showConfirm(
        'メニューの削除',
        'このメニューを削除してもよろしいですか？',
        '削除する',
        'btn-primary'
    );

    if (!confirmed) return;

    try {
        await api(`/api/admin/services/${id}`, { method: 'DELETE' });
        loadServices();
    } catch (error) {
        alert(error.message);
    }
}

// DnD処理（メニュー用）
let dragServiceSrcEl = null;

function handleServiceDragStart(e) {
    dragServiceSrcEl = this;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', this.innerHTML);
    this.classList.add('dragging');
}

function handleServiceDragOver(e) {
    if (e.preventDefault) {
        e.preventDefault();
    }
    e.dataTransfer.dropEffect = 'move';
    return false;
}

function handleServiceDrop(e) {
    if (e.stopPropagation) {
        e.stopPropagation();
    }

    if (dragServiceSrcEl !== this) {
        const tbody = this.parentNode;
        const rows = Array.from(tbody.querySelectorAll('tr.draggable-service-row'));
        const srcIndex = rows.indexOf(dragServiceSrcEl);
        const targetIndex = rows.indexOf(this);

        if (srcIndex < targetIndex) {
            tbody.insertBefore(dragServiceSrcEl, this.nextSibling);
        } else {
            tbody.insertBefore(dragServiceSrcEl, this);
        }

        saveServiceOrder();
    }

    return false;
}

function handleServiceDragEnd(e) {
    this.classList.remove('dragging');
    const rows = document.querySelectorAll('#servicesTable tr.draggable-service-row');
    rows.forEach(row => row.classList.remove('drag-over'));
}

async function saveServiceOrder() {
    const rows = document.querySelectorAll('#servicesTable tr.draggable-service-row');
    const ids = Array.from(rows).map(row => parseInt(row.dataset.id));

    try {
        await api('/api/admin/services/reorder', {
            method: 'PUT',
            body: JSON.stringify({ ids })
        });
    } catch (error) {
        console.error('並び替え保存エラー:', error);
        alert('順序の保存に失敗しました');
    }
}

window.deleteService = deleteService;

// ===== 営業時間テーブル描画 =====
function renderBusinessHoursTable(hours) {
    const tbody = document.querySelector('#businessHoursTable tbody');
    if (!tbody) return;

    tbody.innerHTML = hours.map(h => {
        const day = dayNames[h.day_of_week];
        return `
            <tr data-day="${h.day_of_week}">
                <td><strong>${day}曜日</strong></td>
                <td>
                    <input type="time" class="form-input bh-morning-open" value="${h.morning_open || ''}" ${h.is_closed ? 'disabled' : ''} style="width: 110px;">
                </td>
                <td>
                    <input type="time" class="form-input bh-morning-close" value="${h.morning_close || ''}" ${h.is_closed ? 'disabled' : ''} style="width: 110px;">
                </td>
                <td>
                    <input type="time" class="form-input bh-afternoon-open" value="${h.afternoon_open || ''}" ${h.is_closed ? 'disabled' : ''} style="width: 110px;">
                </td>
                <td>
                    <input type="time" class="form-input bh-afternoon-close" value="${h.afternoon_close || ''}" ${h.is_closed ? 'disabled' : ''} style="width: 110px;">
                </td>
                <td>
                    <input type="checkbox" class="bh-closed" ${h.is_closed ? 'checked' : ''} style="width: 20px; height: 20px;">
                </td>
                <td>
                    <button class="btn btn-primary save-hours-btn" data-day="${h.day_of_week}" style="padding: 6px 12px; font-size: 0.875rem;">保存</button>
                </td>
            </tr>
        `;
    }).join('');

    // 休診チェックボックスのイベント
    tbody.querySelectorAll('.bh-closed').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const row = e.target.closest('tr');
            const inputs = row.querySelectorAll('input[type="time"]');
            inputs.forEach(input => {
                input.disabled = e.target.checked;
                if (e.target.checked) input.value = '';
            });
        });
    });

    // 保存ボタンのイベント
    tbody.querySelectorAll('.save-hours-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const dayOfWeek = e.target.dataset.day;
            const row = e.target.closest('tr');

            const data = {
                isClosed: row.querySelector('.bh-closed').checked,
                morningOpen: row.querySelector('.bh-morning-open').value || null,
                morningClose: row.querySelector('.bh-morning-close').value || null,
                afternoonOpen: row.querySelector('.bh-afternoon-open').value || null,
                afternoonClose: row.querySelector('.bh-afternoon-close').value || null
            };

            try {
                await api(`/api/admin/business-hours/${dayOfWeek}`, {
                    method: 'PUT',
                    body: JSON.stringify(data)
                });
                showBusinessHoursAlert('success', `${dayNames[dayOfWeek]}曜日の設定を保存しました`);
            } catch (error) {
                showBusinessHoursAlert('error', error.message);
            }
        });
    });
}

function showBusinessHoursAlert(type, message) {
    const alert = document.getElementById('businessHoursAlert');
    if (!alert) return;
    alert.className = `alert alert-${type}`;
    alert.textContent = message;
    alert.style.display = 'block';
    setTimeout(() => { alert.style.display = 'none'; }, 3000);
}

// ===== スケジュール例外管理 =====

const exceptionTypeLabels = {
    'closed': '臨時休業',
    'partial_closed': '時間帯休業',
    'modified_hours': '営業時間変更',
    'special_open': '特別営業'
};

async function loadScheduleExceptions() {
    try {
        const exceptions = await api('/api/admin/schedule-exceptions');
        renderScheduleExceptionsTable(exceptions);
    } catch (error) {
        console.error('スケジュール例外読み込みエラー:', error);
    }
}

function renderScheduleExceptionsTable(exceptions) {
    const tbody = document.querySelector('#scheduleExceptionsTable tbody');
    if (!tbody) return;

    if (exceptions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--muted);">スケジュール例外が登録されていません</td></tr>';
        return;
    }

    tbody.innerHTML = exceptions.map(ex => {
        let timeDisplay = '-';
        if (ex.exception_type === 'partial_closed' && ex.start_time && ex.end_time) {
            timeDisplay = `${ex.start_time} 〜 ${ex.end_time}`;
        } else if ((ex.exception_type === 'modified_hours' || ex.exception_type === 'special_open')) {
            const parts = [];
            if (ex.morning_open && ex.morning_close) {
                parts.push(`午前: ${ex.morning_open}-${ex.morning_close}`);
            }
            if (ex.afternoon_open && ex.afternoon_close) {
                parts.push(`午後: ${ex.afternoon_open}-${ex.afternoon_close}`);
            }
            timeDisplay = parts.join('<br>') || '-';
        }

        const dateDisplay = ex.start_date === ex.end_date
            ? ex.start_date
            : `${ex.start_date} 〜 ${ex.end_date}`;

        return `
            <tr>
                <td>
                    <span class="badge ${getExceptionBadgeClass(ex.exception_type)}">
                        ${exceptionTypeLabels[ex.exception_type] || ex.exception_type}
                    </span>
                </td>
                <td>${dateDisplay}</td>
                <td style="font-size: 0.8rem;">${timeDisplay}</td>
                <td>${escapeHtml(ex.reason || '-')}</td>
                <td>${ex.is_recurring ? '○' : '-'}</td>
                <td>
                    <button class="btn btn-secondary delete-exception-btn" data-id="${ex.id}" 
                        style="padding: 4px 8px; font-size: 0.75rem; color: #ef4444; border-color: #ef4444;">削除</button>
                </td>
            </tr>
        `;
    }).join('');
}

function getExceptionBadgeClass(type) {
    switch (type) {
        case 'closed': return 'badge-cancelled';
        case 'partial_closed': return 'badge-pending';
        case 'modified_hours': return 'badge-confirmed';
        case 'special_open': return 'badge-success';
        default: return '';
    }
}

// 例外タイプ変更時のフォーム表示切り替え
document.getElementById('exceptionType')?.addEventListener('change', (e) => {
    const type = e.target.value;
    const partialFields = document.getElementById('partialClosedFields');
    const modifiedFields = document.getElementById('modifiedHoursFields');

    if (partialFields) {
        partialFields.style.display = type === 'partial_closed' ? 'block' : 'none';
    }
    if (modifiedFields) {
        modifiedFields.style.display = (type === 'modified_hours' || type === 'special_open') ? 'block' : 'none';
    }
});

// スケジュール例外登録
document.getElementById('addScheduleExceptionForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const data = {
        exceptionType: document.getElementById('exceptionType').value,
        startDate: document.getElementById('exceptionStartDate').value,
        endDate: document.getElementById('exceptionEndDate').value,
        startTime: document.getElementById('exceptionStartTime')?.value || null,
        endTime: document.getElementById('exceptionEndTime')?.value || null,
        morningOpen: document.getElementById('exceptionMorningOpen')?.value || null,
        morningClose: document.getElementById('exceptionMorningClose')?.value || null,
        afternoonOpen: document.getElementById('exceptionAfternoonOpen')?.value || null,
        afternoonClose: document.getElementById('exceptionAfternoonClose')?.value || null,
        reason: document.getElementById('exceptionReason')?.value || null,
        notes: document.getElementById('exceptionNotes')?.value || null,
        isRecurring: document.getElementById('exceptionRecurring')?.checked || false
    };

    const alertBox = document.getElementById('scheduleExceptionAlert');

    try {
        const result = await api('/api/admin/schedule-exceptions', {
            method: 'POST',
            body: JSON.stringify(data)
        });

        document.getElementById('addScheduleExceptionForm').reset();
        // フォームフィールドも非表示に
        document.getElementById('partialClosedFields').style.display = 'none';
        document.getElementById('modifiedHoursFields').style.display = 'none';

        if (alertBox) {
            alertBox.className = 'alert alert-success';
            alertBox.textContent = result.message;
            alertBox.style.display = 'block';
            setTimeout(() => { alertBox.style.display = 'none'; }, 3000);
        }

        loadScheduleExceptions();
    } catch (error) {
        if (alertBox) {
            alertBox.className = 'alert alert-error';
            alertBox.textContent = error.message;
            alertBox.style.display = 'block';
        }
    }
});

// 削除イベントのデリゲーション
document.getElementById('scheduleExceptionsTable')?.addEventListener('click', async (e) => {
    if (e.target.classList.contains('delete-exception-btn')) {
        const id = e.target.dataset.id;
        await deleteScheduleException(id);
    }
});

async function deleteScheduleException(id) {
    const confirmed = await showConfirm(
        'スケジュール例外の削除',
        'このスケジュール例外を削除してもよろしいですか？',
        '削除する',
        'btn-primary'
    );

    if (!confirmed) return;

    try {
        await api(`/api/admin/schedule-exceptions/${id}`, { method: 'DELETE' });
        loadScheduleExceptions();
    } catch (error) {
        alert(error.message);
    }
}

window.deleteScheduleException = deleteScheduleException;


// ===== 予約削除・新規作成 =====

async function deleteAppointment(id) {
    const confirmed = await showConfirm(
        '予約の削除',
        'この予約を完全に削除しますか？\n（この操作は取り消せません）',
        '削除する',
        'btn-danger' // 赤ボタンにするためのクラス（CSS要確認、なければbtn-secondary等で代用）
    );

    if (!confirmed) return;

    try {
        await api(`/api/admin/appointments/${id}`, { method: 'DELETE' });
        closeModal();
        loadCalendar();
        loadAppointments();
    } catch (error) {
        alert(error.message);
    }
}

// 新規予約モーダル
const createModal = document.getElementById('createAppointmentModal');
const createForm = document.getElementById('createAppointmentForm');

// ボタンイベント
document.getElementById('newAppointmentBtn')?.addEventListener('click', openCreateModalNew);
document.getElementById('openCreateModalBtn')?.addEventListener('click', openCreateModalNew);

document.getElementById('closeCreateModal')?.addEventListener('click', closeCreateModal);
document.getElementById('createModalCancel')?.addEventListener('click', closeCreateModal);

document.getElementById('createModalSave')?.addEventListener('click', async () => {
    if (createForm.checkValidity()) {
        await createAppointment();
    } else {
        createForm.reportValidity();
    }
});

async function openCreateModal() {
    // メニュー読み込み
    try {
        const services = await api('/api/services');
        const select = document.getElementById('newAptService');
        // APIによっては duration または duration_minutes で返ってくるため両対応
        select.innerHTML = services.map(s =>
            `<option value="${s.id}">${escapeHtml(s.name)} (${s.duration || s.duration_minutes}分)</option>`
        ).join('');

        // 初期値（日付は今日）
        const now = new Date();
        const dStr = formatDate(now); // YYYY-MM-DD
        document.getElementById('newAptDate').value = dStr;

        // 空き枠更新
        await updateAvailableTimes();



        // 次の枠を選択
        let nextMinutes = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 30) * 30;
        let setHours = Math.floor(nextMinutes / 60);
        let setMinutes = nextMinutes % 60;

        // 営業時間を超えていれば最後の枠or翌日だが、とりあえず単純にセット
        const timeStr = `${String(setHours).padStart(2, '0')}:${String(setMinutes).padStart(2, '0')}`;
        // 選択肢にあるか確認してセット
        if (timeSelect.querySelector(`option[value="${timeStr}"]`)) {
            timeSelect.value = timeStr;
        } else {
            timeSelect.selectedIndex = 0;
        }

        createModal.classList.add('active');
    } catch (error) {
        console.error('メニュー読み込みエラー:', error);
        alert('メニューの読み込みに失敗しました');
    }
}

function closeCreateModal() {
    createModal.classList.remove('active');
    createForm.reset();
}

async function createAppointment() {
    const name = document.getElementById('newAptName').value;
    const dateStr = document.getElementById('newAptDate').value;
    const timeStr = document.getElementById('newAptTime').value;
    const serviceId = document.getElementById('newAptService').value;
    const notes = document.getElementById('newAptNotes').value;

    const startAt = `${dateStr}T${timeStr}:00+09:00`; // JST(日本時間)を明示して送信

    // Loading表示の代わりにボタン無効化
    const btn = document.getElementById('createModalSave');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '登録中...';

    try {
        await api('/api/admin/appointments', {
            method: 'POST',
            body: JSON.stringify({ name, startAt, serviceId, notes })
        });

        closeCreateModal();
        loadCalendar();
        loadAppointments();

        alert('予約を登録しました');

    } catch (error) {
        alert(error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

// 日付・メニュー変更時に空き枠を再取得
document.getElementById('newAptDate')?.addEventListener('change', updateAvailableTimes);
document.getElementById('newAptService')?.addEventListener('change', updateAvailableTimes);

async function updateAvailableTimes() {
    const dateStr = document.getElementById('newAptDate').value;
    const serviceId = document.getElementById('newAptService').value;
    const timeSelect = document.getElementById('newAptTime');

    if (!dateStr || !serviceId) return;

    // Loading表示
    timeSelect.innerHTML = '<option value="">読み込み中...</option>';
    timeSelect.disabled = true;

    try {
        // 空き枠APIを呼び出す
        const result = await api(`/api/slots?date=${dateStr}&serviceId=${serviceId}`);
        const slots = result.slots || [];

        timeSelect.innerHTML = '';
        timeSelect.disabled = false;

        if (slots.length === 0) {
            timeSelect.innerHTML = '<option value="">空き枠なし</option>';
            return;
        }

        let hasAvailable = false;
        slots.forEach(slot => {
            if (slot.available) {
                // そのまま追加
                timeSelect.innerHTML += `<option value="${slot.time}">${slot.time}</option>`;
                hasAvailable = true;
            }
        });

        if (!hasAvailable) {
            timeSelect.innerHTML = '<option value="">空き枠なし</option>';
        }

    } catch (error) {
        console.error('空き枠取得エラー:', error);
        timeSelect.innerHTML = '<option value="">取得エラー</option>';
        timeSelect.disabled = false;
    }
}

async function openCreateModalNew() {
    // メニュー読み込み
    try {
        const services = await api('/api/services');
        const select = document.getElementById('newAptService');
        select.innerHTML = services.map(s =>
            `<option value="${s.id}">${escapeHtml(s.name)} (${s.duration || s.duration_minutes}分)</option>`
        ).join('');

        // 初期値（日付は今日）
        const now = new Date();
        const dStr = formatDate(now);
        document.getElementById('newAptDate').value = dStr;

        // 空き枠更新
        await updateAvailableTimes();

        createModal.classList.add('active');
    } catch (error) {
        console.error('メニュー読み込みエラー:', error);
        alert('メニューの読み込みに失敗しました');
    }
}

// ===== キャパシティ設定管理 =====

let capacitySettings = {
    defaultCapacity: 1,
    capacities: []
};

async function loadCapacitySettings() {
    try {
        const result = await api('/api/admin/slot-capacities');
        capacitySettings.defaultCapacity = result.defaultCapacity;
        capacitySettings.capacities = result.capacities;

        document.getElementById('defaultCapacity').value = result.defaultCapacity;
        renderCapacityMatrix();
    } catch (error) {
        console.error('キャパシティ設定読み込みエラー:', error);
    }
}

function renderCapacityMatrix() {
    const tbody = document.getElementById('capacityMatrixBody');
    if (!tbody) return;

    // 時間帯 (9:00 〜 18:30)
    const timeSlots = [];
    for (let h = 9; h < 19; h++) {
        timeSlots.push(`${String(h).padStart(2, '0')}:00`);
        timeSlots.push(`${String(h).padStart(2, '0')}:30`);
    }

    // 曜日順序: 月火水木金土日 = 1,2,3,4,5,6,0
    const dayOrder = [1, 2, 3, 4, 5, 6, 0];

    let html = '';
    timeSlots.forEach(time => {
        html += `<tr>`;
        html += `<td style="font-weight: 600;">${time}</td>`;

        dayOrder.forEach(dayOfWeek => {
            // 個別設定があればその値、なければデフォルト
            const customSetting = capacitySettings.capacities.find(
                c => c.day_of_week === dayOfWeek && c.time_slot === time + ':00'
            );
            const capacity = customSetting ? customSetting.capacity : capacitySettings.defaultCapacity;
            const isCustom = !!customSetting;

            html += `<td>
                <input type="number" 
                    class="form-input capacity-input" 
                    data-day="${dayOfWeek}" 
                    data-time="${time}"
                    value="${capacity}" 
                    min="1" 
                    max="10"
                    style="width: 50px; padding: 4px; text-align: center; ${isCustom ? 'background: #e0f2fe; border-color: #0284c7;' : ''}"
                >
            </td>`;
        });

        html += `</tr>`;
    });

    tbody.innerHTML = html;
}

// デフォルトキャパシティ保存
document.getElementById('saveDefaultCapacity')?.addEventListener('click', async () => {
    const capacity = parseInt(document.getElementById('defaultCapacity').value);

    if (!capacity || capacity < 1) {
        showCapacityAlert('error', '1以上の数値を入力してください');
        return;
    }

    try {
        await api('/api/admin/slot-capacities/default', {
            method: 'PUT',
            body: JSON.stringify({ capacity })
        });

        capacitySettings.defaultCapacity = capacity;
        showCapacityAlert('success', 'デフォルト上限人数を保存しました');
        renderCapacityMatrix();
    } catch (error) {
        showCapacityAlert('error', error.message);
    }
});

// 全枠にデフォルト値を適用
document.getElementById('applyDefaultToAll')?.addEventListener('click', async () => {
    const capacity = parseInt(document.getElementById('defaultCapacity').value);

    if (!capacity || capacity < 1) {
        showCapacityAlert('error', '1以上の数値を入力してください');
        return;
    }

    // 全ての個別設定を削除（デフォルト値に戻す）
    try {
        // まず現在の全設定を削除するために、全セルを null で送信
        const capacities = [];
        capacitySettings.capacities.forEach(c => {
            capacities.push({
                dayOfWeek: c.day_of_week,
                timeSlot: c.time_slot,
                capacity: null // 削除
            });
        });

        if (capacities.length > 0) {
            await api('/api/admin/slot-capacities/bulk', {
                method: 'PUT',
                body: JSON.stringify({ capacities })
            });
        }

        // デフォルト値も更新
        await api('/api/admin/slot-capacities/default', {
            method: 'PUT',
            body: JSON.stringify({ capacity })
        });

        capacitySettings.capacities = [];
        capacitySettings.defaultCapacity = capacity;
        renderCapacityMatrix();
        showCapacityAlert('success', `全ての枠を ${capacity} 人に設定しました`);
    } catch (error) {
        showCapacityAlert('error', error.message);
    }
});

// マトリクス変更を保存
document.getElementById('saveCapacityMatrix')?.addEventListener('click', async () => {
    const inputs = document.querySelectorAll('.capacity-input');
    const capacities = [];

    inputs.forEach(input => {
        const dayOfWeek = parseInt(input.dataset.day);
        const timeSlot = input.dataset.time + ':00'; // "09:00" -> "09:00:00"
        const capacity = parseInt(input.value);

        if (capacity !== capacitySettings.defaultCapacity) {
            // デフォルトと異なる場合のみ個別設定として保存
            capacities.push({ dayOfWeek, timeSlot, capacity });
        } else {
            // デフォルトと同じなら個別設定を削除
            capacities.push({ dayOfWeek, timeSlot, capacity: null });
        }
    });

    try {
        await api('/api/admin/slot-capacities/bulk', {
            method: 'PUT',
            body: JSON.stringify({ capacities })
        });

        showCapacityAlert('success', 'キャパシティ設定を保存しました');
        await loadCapacitySettings(); // 再読み込み
    } catch (error) {
        showCapacityAlert('error', error.message);
    }
});

// 特定日の設定管理
document.getElementById('capacityDateInput')?.addEventListener('change', async (e) => {
    const date = e.target.value;
    if (!date) {
        document.getElementById('dateCapacityContainer').style.display = 'none';
        return;
    }

    document.getElementById('dateCapacityContainer').style.display = 'block';
    await loadDateCapacity(date);
});

async function loadDateCapacity(date) {
    try {
        const result = await api(`/api/admin/slot-capacities/date/${date}`);
        renderDateCapacityGrid(result.capacities);
    } catch (error) {
        console.error('特定日設定読み込みエラー:', error);
        showCapacityAlert('error', '設定の読み込みに失敗しました');
    }
}

function renderDateCapacityGrid(capacities) {
    const container = document.getElementById('dateCapacityGrid');
    container.innerHTML = '';

    capacities.forEach(item => {
        const isDateSpecific = item.source === 'date';
        const isDaySpecific = item.source === 'day';

        let bgColor = '#ffffff';
        let borderColor = '#d1d5db';

        if (isDateSpecific) {
            bgColor = '#e0f2fe';
            borderColor = '#0284c7';
        } else if (isDaySpecific) {
            bgColor = '#f3f4f6';
        }

        container.innerHTML += `
            <div style="display: flex; flex-direction: column; gap: 4px;">
                <label style="font-size: 0.8rem; color: var(--muted);">${item.timeSlot}</label>
                <input type="number" 
                    class="form-input date-capacity-input" 
                    data-time="${item.timeSlot}"
                    value="${item.capacity}" 
                    min="1" 
                    max="10"
                    style="padding: 4px; text-align: center; background: ${bgColor}; border-color: ${borderColor};"
                >
            </div>
        `;
    });
}

document.getElementById('saveDateCapacity')?.addEventListener('click', async () => {
    const date = document.getElementById('capacityDateInput').value;
    if (!date) return;

    const inputs = document.querySelectorAll('.date-capacity-input');
    const capacities = [];

    inputs.forEach(input => {
        capacities.push({
            timeSlot: input.dataset.time + ':00',
            capacity: parseInt(input.value)
        });
    });

    try {
        await api(`/api/admin/slot-capacities/date/${date}`, {
            method: 'PUT',
            body: JSON.stringify({ capacities })
        });

        showCapacityAlert('success', `${date} の設定を保存しました`);
        await loadDateCapacity(date); // 再描画して色を更新
    } catch (error) {
        showCapacityAlert('error', error.message);
    }
});

function showCapacityAlert(type, message) {
    const alert = document.getElementById('capacityAlert');
    if (!alert) return;
    alert.className = `alert alert-${type}`;
    alert.textContent = message;
    alert.style.display = 'block';
    setTimeout(() => { alert.style.display = 'none'; }, 4000);
}

// 設定タブ表示時にキャパシティ設定を読み込む
const origLoadSettings = typeof loadSettings === 'function' ? loadSettings : null;
if (origLoadSettings) {
    window.loadSettings = async function () {
        await origLoadSettings();
        await loadCapacitySettings();
    };
} else {
    // loadSettings が定義されていなければ新たに定義
    async function loadSettings() {
        await loadCapacitySettings();
    }
}
