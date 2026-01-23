/**
 * 歯科医院予約システム - 患者向け予約フロー
 */

// ===== 状態管理 =====
const state = {
    currentStep: 1,
    services: [],
    staff: [],
    availableDates: [],
    selectedService: null,
    selectedStaff: null,
    selectedDate: null,
    selectedSlot: null,
    customerInfo: {},
    currentMonth: new Date()
};

// ===== DOM要素 =====
const elements = {
    globalError: document.getElementById('globalError'),
    progressContainer: document.getElementById('progressContainer'),
    serviceList: document.getElementById('serviceList'),
    staffList: document.getElementById('staffList'),
    dateGrid: document.getElementById('dateGrid'),
    slotGrid: document.getElementById('slotGrid'),
    timeSection: document.getElementById('timeSection'),
    monthTitle: document.getElementById('monthTitle'),
    selectedDateLabel: document.getElementById('selectedDateLabel')
};

// ===== 初期化 =====
document.addEventListener('DOMContentLoaded', async () => {
    // URLパラメータをチェック（キャンセル用トークン）
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (token) {
        // 予約確認・キャンセル画面を表示
        showCancelView(token);
        return;
    }

    // 通常の予約フロー
    try {
        await Promise.all([
            loadServices(),
            loadStaff(),
            loadAvailableDates()
        ]);
        setupEventListeners();
        renderCalendar();
    } catch (error) {
        showError('データの読み込みに失敗しました。ページを再読み込みしてください。');
    }
});

// ===== API通信 =====
async function api(endpoint, options = {}) {
    const response = await fetch(endpoint, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        }
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || 'エラーが発生しました');
    }

    return data;
}

async function loadServices() {
    const services = await api('/api/services');
    state.services = services;
    renderServices();
}

async function loadStaff() {
    const staff = await api('/api/staff');
    state.staff = staff;
    renderStaff();
}

async function loadAvailableDates() {
    const dates = await api('/api/available-dates');
    state.availableDates = dates.map(d => d.date);
}

async function loadSlots(date) {
    const params = new URLSearchParams({
        date,
        serviceId: state.selectedService.id
    });

    if (state.selectedStaff && state.selectedStaff.id) {
        params.append('staffId', state.selectedStaff.id);
    }

    const result = await api(`/api/slots?${params}`);
    return result.slots || [];
}

// ===== レンダリング =====
function renderServices() {
    elements.serviceList.innerHTML = state.services.map(service => `
        <label class="option-item" data-id="${service.id}">
            <input type="radio" name="service" value="${service.id}">
            <div class="option-name">${escapeHtml(service.name)}</div>
            ${service.description ? `<div class="option-description">${escapeHtml(service.description)}</div>` : ''}
            <span class="option-duration">${service.duration}分</span>
        </label>
    `).join('');
}

function renderStaff() {
    const staffWithNoPreference = [
        { id: null, name: '指名なし', title: 'どなたでも可' },
        ...state.staff
    ];

    elements.staffList.innerHTML = staffWithNoPreference.map(member => `
        <label class="option-item" data-id="${member.id || 'none'}">
            <input type="radio" name="staff" value="${member.id || ''}">
            <div class="option-name">${escapeHtml(member.name)}</div>
            ${member.title ? `<div class="option-description">${escapeHtml(member.title)}</div>` : ''}
        </label>
    `).join('');
}

function renderCalendar() {
    const year = state.currentMonth.getFullYear();
    const month = state.currentMonth.getMonth();

    elements.monthTitle.textContent = `${year}年${month + 1}月`;

    // 月の最初の日と最後の日
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    // カレンダーのグリッドをクリア（ヘッダーは残す）
    const headerCells = elements.dateGrid.querySelectorAll('.date-header');
    elements.dateGrid.innerHTML = '';
    headerCells.forEach(cell => elements.dateGrid.appendChild(cell));

    // 最初の日の曜日分の空セル
    for (let i = 0; i < firstDay.getDay(); i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'date-cell disabled';
        elements.dateGrid.appendChild(emptyCell);
    }

    // 日付セル
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let day = 1; day <= lastDay.getDate(); day++) {
        const date = new Date(year, month, day);
        const dateStr = formatDate(date);
        const isAvailable = state.availableDates.includes(dateStr);
        const isToday = date.getTime() === today.getTime();
        const isSelected = state.selectedDate === dateStr;

        const cell = document.createElement('div');
        cell.className = 'date-cell';
        cell.textContent = day;
        cell.dataset.date = dateStr;

        if (!isAvailable) {
            cell.classList.add('disabled');
        }
        if (isToday) {
            cell.classList.add('today');
        }
        if (isSelected) {
            cell.classList.add('selected');
        }

        elements.dateGrid.appendChild(cell);
    }
}

async function renderSlots(date) {
    elements.slotGrid.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    elements.timeSection.style.display = 'block';

    const dateObj = new Date(date);
    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
    elements.selectedDateLabel.textContent =
        `${dateObj.getMonth() + 1}月${dateObj.getDate()}日（${dayNames[dateObj.getDay()]}）の空き時間`;

    try {
        const slots = await loadSlots(date);

        if (slots.length === 0) {
            elements.slotGrid.innerHTML = '<div class="no-slots">この日は空きがありません</div>';
            return;
        }

        elements.slotGrid.innerHTML = slots.map(slot => `
            <div class="slot-item" data-start="${slot.startAt}" data-end="${slot.endAt}">
                ${slot.start}
            </div>
        `).join('');
    } catch (error) {
        elements.slotGrid.innerHTML = `<div class="no-slots">${escapeHtml(error.message)}</div>`;
    }
}

// ===== イベントリスナー =====
function setupEventListeners() {
    // サービス選択
    elements.serviceList.addEventListener('click', (e) => {
        const item = e.target.closest('.option-item');
        if (!item) return;

        document.querySelectorAll('#serviceList .option-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
        item.querySelector('input').checked = true;

        const serviceId = parseInt(item.dataset.id);
        state.selectedService = state.services.find(s => s.id === serviceId);

        document.getElementById('nextStep1').disabled = false;
    });

    // スタッフ選択
    elements.staffList.addEventListener('click', (e) => {
        const item = e.target.closest('.option-item');
        if (!item) return;

        document.querySelectorAll('#staffList .option-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
        item.querySelector('input').checked = true;

        const staffId = item.dataset.id;
        if (staffId === 'none') {
            state.selectedStaff = { id: null, name: '指名なし' };
        } else {
            state.selectedStaff = state.staff.find(s => s.id === parseInt(staffId));
        }

        document.getElementById('nextStep2').disabled = false;
    });

    // 日付選択
    elements.dateGrid.addEventListener('click', (e) => {
        const cell = e.target.closest('.date-cell:not(.disabled):not(.date-header)');
        if (!cell) return;

        document.querySelectorAll('#dateGrid .date-cell').forEach(el => el.classList.remove('selected'));
        cell.classList.add('selected');

        state.selectedDate = cell.dataset.date;
        state.selectedSlot = null;
        document.getElementById('nextStep3').disabled = true;

        renderSlots(state.selectedDate);
    });

    // 時間スロット選択
    elements.slotGrid.addEventListener('click', (e) => {
        const slot = e.target.closest('.slot-item:not(.disabled)');
        if (!slot) return;

        document.querySelectorAll('#slotGrid .slot-item').forEach(el => el.classList.remove('selected'));
        slot.classList.add('selected');

        state.selectedSlot = {
            startAt: slot.dataset.start,
            endAt: slot.dataset.end,
            display: slot.textContent.trim()
        };

        document.getElementById('nextStep3').disabled = false;
    });

    // 月ナビゲーション
    document.getElementById('prevMonth').addEventListener('click', () => {
        state.currentMonth.setMonth(state.currentMonth.getMonth() - 1);
        renderCalendar();
    });

    document.getElementById('nextMonth').addEventListener('click', () => {
        state.currentMonth.setMonth(state.currentMonth.getMonth() + 1);
        renderCalendar();
    });

    // ステップナビゲーション
    document.getElementById('nextStep1').addEventListener('click', () => goToStep(2));
    document.getElementById('prevStep2').addEventListener('click', () => goToStep(1));
    document.getElementById('nextStep2').addEventListener('click', () => goToStep(3));
    document.getElementById('prevStep3').addEventListener('click', () => goToStep(2));
    document.getElementById('nextStep3').addEventListener('click', () => goToStep(4));
    document.getElementById('prevStep4').addEventListener('click', () => goToStep(3));
    document.getElementById('nextStep4').addEventListener('click', () => {
        if (validateForm()) {
            collectFormData();
            showConfirmation();
            goToStep(5);
        }
    });
    document.getElementById('prevStep5').addEventListener('click', () => goToStep(4));
    document.getElementById('submitBooking').addEventListener('click', submitBooking);
}

// ===== ステップ管理 =====
function goToStep(step) {
    // 現在のステップを非表示
    document.getElementById(`step${state.currentStep}`).classList.remove('active');

    // 新しいステップを表示
    document.getElementById(`step${step}`).classList.add('active');

    // プログレスバー更新
    document.querySelectorAll('.progress-step').forEach(el => {
        const stepNum = parseInt(el.dataset.step);
        el.classList.remove('active', 'completed');
        if (stepNum < step) {
            el.classList.add('completed');
        } else if (stepNum === step) {
            el.classList.add('active');
        }
    });

    state.currentStep = step;
    window.scrollTo(0, 0);
}

// ===== フォームバリデーション =====
function validateForm() {
    const name = document.getElementById('name').value.trim();
    const kana = document.getElementById('kana').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const email = document.getElementById('email').value.trim();

    const errors = [];

    if (!name) errors.push('氏名を入力してください');
    if (!kana) errors.push('ふりがなを入力してください');
    if (!phone) errors.push('電話番号を入力してください');

    // ふりがなのバリデーション（ひらがな・カタカナ・スペース）
    if (kana && !/^[\u3040-\u309F\u30A0-\u30FF\u30FC\s]+$/.test(kana)) {
        errors.push('ふりがなはひらがなまたはカタカナで入力してください');
    }

    // 電話番号のバリデーション
    const cleanPhone = phone.replace(/[-\s]/g, '');
    if (phone && !/^0\d{9,10}$/.test(cleanPhone)) {
        errors.push('有効な電話番号を入力してください');
    }

    // メールのバリデーション
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.push('有効なメールアドレスを入力してください');
    }

    if (errors.length > 0) {
        showError(errors.join('<br>'));
        return false;
    }

    hideError();
    return true;
}

function collectFormData() {
    state.customerInfo = {
        name: document.getElementById('name').value.trim(),
        kana: document.getElementById('kana').value.trim(),
        phone: document.getElementById('phone').value.trim(),
        email: document.getElementById('email').value.trim(),
        address: document.getElementById('address').value.trim()
    };
}

function showConfirmation() {
    document.getElementById('confirmService').textContent = state.selectedService.name;
    document.getElementById('confirmStaff').textContent = state.selectedStaff.name;

    const dateObj = new Date(state.selectedSlot.startAt);
    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
    document.getElementById('confirmDateTime').textContent =
        `${dateObj.getFullYear()}年${dateObj.getMonth() + 1}月${dateObj.getDate()}日（${dayNames[dateObj.getDay()]}） ${state.selectedSlot.display}`;

    document.getElementById('confirmName').textContent = `${state.customerInfo.name}（${state.customerInfo.kana}）`;
    document.getElementById('confirmPhone').textContent = state.customerInfo.phone;

    if (state.customerInfo.email) {
        document.getElementById('confirmEmail').textContent = state.customerInfo.email;
        document.getElementById('confirmEmailSection').style.display = 'block';
    } else {
        document.getElementById('confirmEmailSection').style.display = 'none';
    }
}

// ===== 予約送信 =====
async function submitBooking() {
    const submitBtn = document.getElementById('submitBooking');
    submitBtn.disabled = true;
    submitBtn.textContent = '送信中...';

    try {
        const data = {
            serviceId: state.selectedService.id,
            staffId: state.selectedStaff.id,
            startAt: state.selectedSlot.startAt,
            endAt: state.selectedSlot.endAt,
            name: state.customerInfo.name,
            kana: state.customerInfo.kana,
            phone: state.customerInfo.phone,
            email: state.customerInfo.email || null,
            address: state.customerInfo.address || null
        };

        const result = await api('/api/appointments', {
            method: 'POST',
            body: JSON.stringify(data)
        });

        // 完了画面を表示
        showComplete(result);

    } catch (error) {
        showError(error.message);
        submitBtn.disabled = false;
        submitBtn.textContent = '予約を確定する';
    }
}

function showComplete(result) {
    // プログレスバーを非表示
    elements.progressContainer.style.display = 'none';

    // 現在のステップを非表示
    document.getElementById(`step${state.currentStep}`).classList.remove('active');

    // 完了画面を表示
    document.getElementById('stepComplete').classList.add('active');

    // 完了情報を設定
    document.getElementById('completeId').textContent = `#${result.appointmentId}`;

    const dateObj = new Date(result.appointment.startAt);
    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
    document.getElementById('completeDateTime').textContent =
        `${dateObj.getFullYear()}年${dateObj.getMonth() + 1}月${dateObj.getDate()}日（${dayNames[dateObj.getDay()]}） ${state.selectedSlot.display}`;

    document.getElementById('completeService').textContent = result.appointment.service;
    document.getElementById('completeStaff').textContent = result.appointment.staff;
}

// ===== キャンセル画面 =====
async function showCancelView(token) {
    // プログレスバーを非表示
    elements.progressContainer.style.display = 'none';

    // キャンセル画面を表示
    document.querySelectorAll('.step-content').forEach(el => el.classList.remove('active'));
    document.getElementById('stepCancel').classList.add('active');

    try {
        const appointment = await api(`/api/appointments/by-token?token=${encodeURIComponent(token)}`);

        const dateObj = new Date(appointment.startAt);
        const dayNames = ['日', '月', '火', '水', '木', '金', '土'];

        document.getElementById('appointmentDetails').innerHTML = `
            <div class="confirm-section">
                <div class="confirm-title">予約番号</div>
                <div class="confirm-value">#${appointment.id}</div>
            </div>
            <div class="confirm-section">
                <div class="confirm-title">お名前</div>
                <div class="confirm-value">${escapeHtml(appointment.patientName)}</div>
            </div>
            <div class="confirm-section">
                <div class="confirm-title">日時</div>
                <div class="confirm-value">${dateObj.getFullYear()}年${dateObj.getMonth() + 1}月${dateObj.getDate()}日（${dayNames[dateObj.getDay()]}） ${formatTime(dateObj)}</div>
            </div>
            <div class="confirm-section">
                <div class="confirm-title">メニュー</div>
                <div class="confirm-value">${escapeHtml(appointment.serviceName)}</div>
            </div>
            <div class="confirm-section">
                <div class="confirm-title">担当</div>
                <div class="confirm-value">${escapeHtml(appointment.staffName)}</div>
            </div>
            <div class="confirm-section">
                <div class="confirm-title">ステータス</div>
                <div class="confirm-value">
                    <span class="badge badge-${appointment.status}">${getStatusLabel(appointment.status)}</span>
                </div>
            </div>
        `;

        if (appointment.status === 'confirmed') {
            document.getElementById('cancelForm').style.display = 'block';

            document.getElementById('cancelAppointment').addEventListener('click', async () => {
                if (confirm('本当にキャンセルしますか？')) {
                    try {
                        await api('/api/appointments/cancel', {
                            method: 'POST',
                            body: JSON.stringify({ token })
                        });

                        document.getElementById('cancelForm').style.display = 'none';
                        document.getElementById('cancelledMessage').style.display = 'block';

                    } catch (error) {
                        showError(error.message);
                    }
                }
            });
        }

    } catch (error) {
        document.getElementById('appointmentDetails').innerHTML = `
            <div class="alert alert-error">${escapeHtml(error.message)}</div>
        `;
    }
}

// ===== ユーティリティ =====
function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatTime(date) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
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
        cancelled: 'キャンセル済み',
        completed: '完了'
    };
    return labels[status] || status;
}

function showError(message) {
    elements.globalError.innerHTML = message;
    elements.globalError.style.display = 'block';
    window.scrollTo(0, 0);
}

function hideError() {
    elements.globalError.style.display = 'none';
}
