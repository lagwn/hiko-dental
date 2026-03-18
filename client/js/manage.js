/**
 * 歯科医院予約システム - 管理画面
 */

// ===== 状態管理 =====
const state = {
    isLoggedIn: false,
    admin: null,
    currentWeek: new Date(),
    appointments: [],
    calendarRequestId: 0,
    editSlotsRequestId: 0,
    createSlotsRequestId: 0,
    calendarSupportData: null,
    calendarSupportPromise: null,
    calendarWeekCache: new Map(),
    calendarWeekPromises: new Map(),
    calendarDaySchedules: new Map(),
    slotCache: new Map(),
    slotPromises: new Map(),
    services: [],
    servicesPromise: null,
    patients: [],
    recentPatients: [],
    createPatientSuggestions: [],
    selectedCreatePatient: null,
    patientSearchTimer: null,
    patientSearchRequestId: 0,
    editingAppointment: null,
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

function buildWeekCacheKey(startStr, endStr) {
    return `${startStr}|${endStr}`;
}

function buildSlotCacheKey(dateStr, serviceId, excludeAppointmentId = null) {
    return `${dateStr}|${serviceId}|${excludeAppointmentId || ''}`;
}

function clearSlotCache() {
    state.slotCache.clear();
    state.slotPromises.clear();
}

function clearCalendarWeekCache() {
    state.calendarWeekCache.clear();
    state.calendarWeekPromises.clear();
    state.calendarDaySchedules.clear();
}

function invalidateCalendarSupportData() {
    state.calendarSupportData = null;
    state.calendarSupportPromise = null;
}

function invalidateScheduleDependentCaches() {
    invalidateCalendarSupportData();
    clearCalendarWeekCache();
    clearSlotCache();
}

function invalidateAppointmentDependentCaches() {
    clearCalendarWeekCache();
    clearSlotCache();
}

async function ensureCalendarSupportData(forceRefresh = false) {
    if (forceRefresh) {
        invalidateCalendarSupportData();
    }

    if (state.calendarSupportData) {
        return state.calendarSupportData;
    }

    if (state.calendarSupportPromise) {
        return state.calendarSupportPromise;
    }

    state.calendarSupportPromise = Promise.all([
        api('/api/admin/business-hours'),
        api('/api/admin/schedule-exceptions'),
        api('/api/admin/holidays')
    ]).then(([businessHours, scheduleExceptions, holidays]) => {
        state.calendarSupportData = { businessHours, scheduleExceptions, holidays };
        return state.calendarSupportData;
    }).finally(() => {
        state.calendarSupportPromise = null;
    });

    return state.calendarSupportPromise;
}

async function fetchWeekAppointments(startStr, endStr, forceRefresh = false) {
    const cacheKey = buildWeekCacheKey(startStr, endStr);

    if (forceRefresh) {
        state.calendarWeekCache.delete(cacheKey);
        state.calendarWeekPromises.delete(cacheKey);
    }

    if (state.calendarWeekCache.has(cacheKey)) {
        return state.calendarWeekCache.get(cacheKey);
    }

    if (state.calendarWeekPromises.has(cacheKey)) {
        return state.calendarWeekPromises.get(cacheKey);
    }

    const request = api(`/api/admin/appointments?start=${encodeURIComponent(startStr)}&end=${encodeURIComponent(endStr)}`)
        .then((appointments) => {
            state.calendarWeekCache.set(cacheKey, appointments);
            return appointments;
        })
        .finally(() => {
            state.calendarWeekPromises.delete(cacheKey);
        });

    state.calendarWeekPromises.set(cacheKey, request);
    return request;
}

function prefetchCalendarWeek(startOfWeek, offsetDays) {
    const targetStart = new Date(startOfWeek);
    targetStart.setDate(targetStart.getDate() + offsetDays);
    const targetEnd = new Date(targetStart);
    targetEnd.setDate(targetEnd.getDate() + 6);

    const startStr = formatDate(targetStart);
    const endStr = `${formatDate(targetEnd)} 23:59:59`;
    fetchWeekAppointments(startStr, endStr).catch((error) => {
        console.warn('週データ先読みエラー:', error);
    });
}

async function fetchAdminSlots(dateStr, serviceId, options = {}) {
    const { excludeAppointmentId = null, forceRefresh = false } = options;
    const cacheKey = buildSlotCacheKey(dateStr, serviceId, excludeAppointmentId);

    if (forceRefresh) {
        state.slotCache.delete(cacheKey);
        state.slotPromises.delete(cacheKey);
    }

    if (state.slotCache.has(cacheKey)) {
        return state.slotCache.get(cacheKey);
    }

    if (state.slotPromises.has(cacheKey)) {
        return state.slotPromises.get(cacheKey);
    }

    const params = new URLSearchParams({
        date: dateStr,
        serviceId: String(serviceId)
    });
    if (excludeAppointmentId) {
        params.set('excludeAppointmentId', String(excludeAppointmentId));
    }

    const request = api(`/api/admin/slots?${params.toString()}`)
        .then((result) => {
            state.slotCache.set(cacheKey, result);
            return result;
        })
        .finally(() => {
            state.slotPromises.delete(cacheKey);
        });

    state.slotPromises.set(cacheKey, request);
    return request;
}

function getCachedAdminSlots(dateStr, serviceId, options = {}) {
    const { excludeAppointmentId = null } = options;
    return state.slotCache.get(buildSlotCacheKey(dateStr, serviceId, excludeAppointmentId)) || null;
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

    startAppointmentPolling();
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

        // カレンダーの空き枠
        const timeSlot = e.target.closest('.time-slot');
        if (timeSlot) {
            if (timeSlot.dataset.selectable !== 'true') {
                return;
            }
            const hour = String(timeSlot.dataset.hour).padStart(2, '0');
            const minute = String(timeSlot.dataset.minute).padStart(2, '0');
            openCreateModal({
                date: timeSlot.dataset.date,
                time: `${hour}:${minute}`
            });
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

        const patientSuggestion = e.target.closest('.patient-suggestion-item');
        if (patientSuggestion) {
            e.preventDefault();
            selectCreatePatientById(patientSuggestion.getAttribute('data-id'));
            return;
        }

        if (e.target.closest('#clearNewAptPatient')) {
            e.preventDefault();
            clearCreatePatientSelection({ keepName: true });
            hideCreatePatientSuggestions();
            document.getElementById('newAptName').focus();
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

        if (!e.target.closest('#newAptPatientLookup')) {
            hideCreatePatientSuggestions();
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
function normalizeDateString(dateValue) {
    if (!dateValue) return null;
    return String(dateValue).trim().substring(0, 10);
}

function normalizeTimeString(timeValue) {
    if (!timeValue) return null;
    return String(timeValue).trim().substring(0, 5);
}

function timeStringToMinutes(timeValue) {
    const normalized = normalizeTimeString(timeValue);
    if (!normalized) return null;
    const [hours, minutes] = normalized.split(':').map(Number);
    return (hours * 60) + minutes;
}

function getScheduleExceptionPriority(type) {
    switch (type) {
        case 'closed':
            return 1;
        case 'partial_closed':
            return 2;
        case 'modified_hours':
            return 3;
        case 'special_open':
            return 4;
        default:
            return 99;
    }
}

function buildCalendarTimePeriods(hours) {
    const periods = [];
    const addPeriod = (open, close) => {
        const start = timeStringToMinutes(open);
        const end = timeStringToMinutes(close);
        if (start !== null && end !== null && start < end) {
            periods.push({ start, end });
        }
    };

    addPeriod(hours?.morning_open, hours?.morning_close);
    addPeriod(hours?.afternoon_open, hours?.afternoon_close);

    if (periods.length === 0) {
        addPeriod(hours?.open_time, hours?.close_time);
    }

    return periods;
}

function getCalendarDaySchedule(date, businessHoursByDay, scheduleExceptions, holidayMap) {
    const dateStr = formatDate(date);
    const holiday = holidayMap.get(dateStr);

    if (holiday) {
        return {
            isClosedDay: true,
            closedReason: holiday.name || '休診日',
            periods: [],
            partialClosedPeriods: []
        };
    }

    const scheduleException = scheduleExceptions
        .filter(exception => {
            const startDate = normalizeDateString(exception.start_date);
            const endDate = normalizeDateString(exception.end_date);
            return startDate && endDate && startDate <= dateStr && dateStr <= endDate;
        })
        .sort((a, b) => getScheduleExceptionPriority(a.exception_type) - getScheduleExceptionPriority(b.exception_type))[0] || null;

    if (scheduleException?.exception_type === 'closed') {
        return {
            isClosedDay: true,
            closedReason: scheduleException.reason || '休診日',
            periods: [],
            partialClosedPeriods: []
        };
    }

    const dayOfWeek = date.getDay();
    const baseHours = businessHoursByDay.get(dayOfWeek) || null;
    let effectiveHours = baseHours;

    if (scheduleException?.exception_type === 'special_open') {
        effectiveHours = {
            ...(baseHours || {}),
            is_closed: false,
            morning_open: normalizeTimeString(scheduleException.morning_open || baseHours?.morning_open),
            morning_close: normalizeTimeString(scheduleException.morning_close || baseHours?.morning_close),
            afternoon_open: normalizeTimeString(scheduleException.afternoon_open || baseHours?.afternoon_open),
            afternoon_close: normalizeTimeString(scheduleException.afternoon_close || baseHours?.afternoon_close),
            open_time: normalizeTimeString(scheduleException.morning_open || scheduleException.afternoon_open || baseHours?.open_time),
            close_time: normalizeTimeString(scheduleException.afternoon_close || scheduleException.morning_close || baseHours?.close_time)
        };
    } else if (scheduleException?.exception_type === 'modified_hours') {
        effectiveHours = {
            ...(baseHours || {}),
            is_closed: false,
            morning_open: normalizeTimeString(scheduleException.morning_open),
            morning_close: normalizeTimeString(scheduleException.morning_close),
            afternoon_open: normalizeTimeString(scheduleException.afternoon_open),
            afternoon_close: normalizeTimeString(scheduleException.afternoon_close),
            open_time: normalizeTimeString(scheduleException.morning_open || scheduleException.afternoon_open),
            close_time: normalizeTimeString(scheduleException.afternoon_close || scheduleException.morning_close)
        };
    }

    if (!effectiveHours || effectiveHours.is_closed) {
        return {
            isClosedDay: true,
            closedReason: '休診日',
            periods: [],
            partialClosedPeriods: []
        };
    }

    const periods = buildCalendarTimePeriods(effectiveHours);
    if (!periods.length) {
        return {
            isClosedDay: true,
            closedReason: '休診日',
            periods: [],
            partialClosedPeriods: []
        };
    }

    const partialClosedPeriods = scheduleException?.exception_type === 'partial_closed'
        ? [{
            start: timeStringToMinutes(scheduleException.start_time),
            end: timeStringToMinutes(scheduleException.end_time)
        }].filter(period => period.start !== null && period.end !== null && period.start < period.end)
        : [];

    return {
        isClosedDay: false,
        closedReason: '',
        periods,
        partialClosedPeriods
    };
}

function getCalendarSlotState(daySchedule, slotStartMinutes, slotEndMinutes) {
    if (!daySchedule || daySchedule.isClosedDay) {
        return 'closed-day';
    }

    const isInBusinessHours = daySchedule.periods.some(period =>
        slotStartMinutes >= period.start && slotEndMinutes <= period.end
    );

    if (!isInBusinessHours) {
        return 'outside-hours';
    }

    const isInClosedPeriod = daySchedule.partialClosedPeriods.some(period =>
        slotStartMinutes < period.end && slotEndMinutes > period.start
    );

    if (isInClosedPeriod) {
        return 'closed-period';
    }

    return 'open';
}

function getCalendarSlotTitle(dateStr, timeLabel, daySchedule, slotState) {
    switch (slotState) {
        case 'closed-day':
            return `${dateStr} は ${daySchedule?.closedReason || '休診日'} です`;
        case 'outside-hours':
            return `${dateStr} ${timeLabel} は営業時間外です`;
        case 'closed-period':
            return `${dateStr} ${timeLabel} は休業時間です`;
        default:
            return `${dateStr} ${timeLabel} に新規予約を追加`;
    }
}

function doesServiceFitCalendarSchedule(dateStr, startTime, durationMinutes) {
    const daySchedule = state.calendarDaySchedules.get(dateStr);
    const startMinutes = timeStringToMinutes(startTime);

    if (!daySchedule || daySchedule.isClosedDay || startMinutes === null) {
        return false;
    }

    const endMinutes = startMinutes + durationMinutes;
    const fitsPeriod = daySchedule.periods.some(period =>
        startMinutes >= period.start && endMinutes <= period.end
    );

    if (!fitsPeriod) {
        return false;
    }

    return !daySchedule.partialClosedPeriods.some(period =>
        startMinutes < period.end && endMinutes > period.start
    );
}

async function loadCalendar() {
    const requestId = ++state.calendarRequestId;
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
        const endStr = `${formatDate(endOfWeek)} 23:59:59`;

        const [appointments, calendarSupportData] = await Promise.all([
            fetchWeekAppointments(startStr, endStr),
            ensureCalendarSupportData()
        ]);

        if (requestId !== state.calendarRequestId) {
            return;
        }

        renderCalendar(startOfWeek, appointments, calendarSupportData);
        prefetchCalendarWeek(startOfWeek, -7);
        prefetchCalendarWeek(startOfWeek, 7);
    } catch (error) {
        console.error('カレンダー読み込みエラー:', error);
        // エラーをユーザーに通知
        const grid = document.getElementById('calendarGrid');
        grid.innerHTML = `<div style="padding: 20px; color: red; text-align: center;">カレンダーの読み込みに失敗しました。<br>${escapeHtml(error.message)}</div>`;
    } finally {
        // document.getElementById('calendarGrid').style.opacity = '1';
    }
}

function renderCalendar(startOfWeek, appointments, calendarMeta = {}) {
    const grid = document.getElementById('calendarGrid');
    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
    const CALENDAR_START_HOUR = 9;
    const CALENDAR_END_HOUR = 18;
    const SLOT_MINUTES = 30;
    const SLOT_HEIGHT_PX = 56;
    const BLOCK_HEIGHT_PX = 20;
    const SLOT_VERTICAL_PADDING_PX = 4;
    const businessHoursByDay = new Map((calendarMeta.businessHours || []).map(hours => [Number(hours.day_of_week), hours]));
    const holidayMap = new Map((calendarMeta.holidays || [])
        .map(holiday => [normalizeDateString(holiday.date), holiday])
        .filter(([dateStr]) => !!dateStr));
    const daySchedules = Array.from({ length: 7 }, (_, index) => {
        const date = new Date(startOfWeek);
        date.setDate(date.getDate() + index);
        return getCalendarDaySchedule(date, businessHoursByDay, calendarMeta.scheduleExceptions || [], holidayMap);
    });
    state.calendarDaySchedules = new Map(daySchedules.map((schedule, index) => {
        const date = new Date(startOfWeek);
        date.setDate(date.getDate() + index);
        return [formatDate(date), schedule];
    }));

    const calculateTop = (minuteInSlot) => {
        const clampedMinute = Math.max(0, Math.min(SLOT_MINUTES - 1, minuteInSlot));
        const denominator = Math.max(1, SLOT_MINUTES - 1);
        const availableTrack = Math.max(0, SLOT_HEIGHT_PX - (SLOT_VERTICAL_PADDING_PX * 2) - BLOCK_HEIGHT_PX);
        return Math.round(SLOT_VERTICAL_PADDING_PX + (clampedMinute / denominator) * availableTrack);
    };

    // ヘッダー行
    let html = '<div class="calendar-week-header time-col"></div>';
    for (let i = 0; i < 7; i++) {
        const date = new Date(startOfWeek);
        date.setDate(date.getDate() + i);
        const headerClass = daySchedules[i].isClosedDay ? ' calendar-week-header day-closed' : ' calendar-week-header';
        const headerTitle = daySchedules[i].isClosedDay ? ` title="${escapeHtml(daySchedules[i].closedReason)}"` : '';
        html += `<div class="${headerClass.trim()}"${headerTitle}>${dayNames[i]}<br>${date.getMonth() + 1}/${date.getDate()}</div>`;
    }

    // 時間行（30分刻み / 9:00-17:30）
    for (let hour = CALENDAR_START_HOUR; hour < CALENDAR_END_HOUR; hour++) {
        for (let slotMinute = 0; slotMinute < 60; slotMinute += SLOT_MINUTES) {
            const timeLabel = `${hour}:${String(slotMinute).padStart(2, '0')}`;
            html += `<div class="time-label">${timeLabel}</div>`;

            for (let day = 0; day < 7; day++) {
                const date = new Date(startOfWeek);
                date.setDate(date.getDate() + day);
                const dateStr = formatDate(date);
                const slotStartMinutes = (hour * 60) + slotMinute;
                const slotEndMinutes = slotStartMinutes + SLOT_MINUTES;
                const slotState = getCalendarSlotState(daySchedules[day], slotStartMinutes, slotEndMinutes);
                const slotClasses = ['time-slot'];

                if (slotState !== 'open') {
                    slotClasses.push('time-slot-unavailable', `time-slot-${slotState}`);
                }

                // この30分枠に入る予約を取得
                const slotAppointments = appointments.filter(apt => {
                    const d = new Date(apt.start_at);
                    const aptDate = formatDate(d);
                    const aptHour = d.getHours();
                    const aptMinute = d.getMinutes();
                    return aptDate === dateStr && aptHour === hour && aptMinute >= slotMinute && aptMinute < slotMinute + SLOT_MINUTES;
                });

                const sortedSlotAppointments = slotAppointments
                    .slice()
                    .sort((a, b) => new Date(a.start_at) - new Date(b.start_at) || a.id - b.id);

                // 任意分の予約に対応し、重なりが出る場合は横レーンへ自動分割する
                const positionedAppointments = sortedSlotAppointments.map((apt) => {
                    const startAt = new Date(apt.start_at);
                    const minute = startAt.getMinutes();
                    return {
                        apt,
                        startAt,
                        minute,
                        top: calculateTop(minute - slotMinute),
                        lane: 0
                    };
                });

                const laneBottoms = [];
                positionedAppointments.forEach((item) => {
                    const blockBottom = item.top + BLOCK_HEIGHT_PX;
                    let laneIndex = laneBottoms.findIndex(bottom => item.top >= bottom);

                    if (laneIndex === -1) {
                        laneIndex = laneBottoms.length;
                        laneBottoms.push(blockBottom);
                    } else {
                        laneBottoms[laneIndex] = blockBottom;
                    }

                    item.lane = laneIndex;
                });

                const laneCount = Math.max(1, laneBottoms.length);

                html += `<div class="${slotClasses.join(' ')}" data-date="${dateStr}" data-hour="${hour}" data-minute="${slotMinute}" data-selectable="${slotState === 'open'}" title="${escapeHtml(getCalendarSlotTitle(dateStr, timeLabel, daySchedules[day], slotState))}">`;
                positionedAppointments.forEach((item) => {
                    const { apt, startAt, minute, top, lane } = item;
                    const startTime = `${String(startAt.getHours()).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
                    const endAt = new Date(apt.end_at);
                    const endTime = `${String(endAt.getHours()).padStart(2, '0')}:${String(endAt.getMinutes()).padStart(2, '0')}`;

                    const durationMinutes = apt.duration_minutes || SLOT_MINUTES;
                    const blockHeight = Math.max(20, Math.round(durationMinutes / SLOT_MINUTES * SLOT_HEIGHT_PX) - 4);
                    const serviceColor = getServiceColor(apt.service_id);

                    const widthPct = 100 / laneCount;
                    const leftPct = lane * widthPct;
                    const bgStyle = apt.status !== 'cancelled' ? `background:${serviceColor};` : '';
                    const positionStyle = `top:${top}px;left:calc(${leftPct}% + 2px);width:calc(${widthPct}% - 4px);right:auto;height:${blockHeight}px;${bgStyle}`;

                    const patientName = escapeHtml(apt.patient_name || apt.name || '名称未設定');
                    const serviceName = escapeHtml(apt.service_name || '');
                    const titleAttr = `${startTime}〜${endTime} ${patientName}${serviceName ? `（${serviceName}）` : ''}`;

                    let blockContent;
                    if (blockHeight >= 48) {
                        blockContent = `<div class="apt-time">${startTime}〜${endTime}</div><div class="apt-patient">${patientName}</div>${serviceName ? `<div class="apt-service">${serviceName}</div>` : ''}`;
                    } else {
                        blockContent = `<div class="apt-patient">${startTime}〜${endTime} ${patientName}</div>`;
                    }

                    html += `
                        <div class="appointment-block ${apt.status}" data-id="${apt.id}" style="${positionStyle}" title="${escapeHtml(titleAttr)}">
                            ${blockContent}
                        </div>
                    `;
                });
                html += '</div>';
            }
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
        const startDateValue = formatDate(startDate);
        const startTimeValue = formatTimeValue(startDate);

        state.editingAppointment = {
            id: apt.id,
            startAt: apt.start_at,
            serviceId: apt.service_id
        };

        document.getElementById('modalBody').innerHTML = `
            <div class="confirm-section">
                <div class="confirm-title">予約ID</div>
                <div class="confirm-value">#${apt.id}</div>
            </div>
            <div class="confirm-section">
                <div class="confirm-title">日時</div>
                <div class="confirm-value" style="display: flex; gap: 12px; flex-wrap: wrap;">
                    <input type="date" id="aptDate" class="form-input" value="${startDateValue}" style="width: auto; min-width: 180px;">
                    <select id="aptTime" class="form-input" style="width: auto; min-width: 140px;">
                        <option value="">読み込み中...</option>
                    </select>
                </div>
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
                <div class="confirm-value">
                    <select id="aptService" class="form-input" style="width: auto; min-width: 220px;">
                        <option value="">読み込み中...</option>
                    </select>
                </div>
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
        await populateAppointmentServiceOptions(apt.service_id);
        await loadAppointmentTimeOptions(id, startTimeValue);

        document.getElementById('aptDate').addEventListener('change', () => {
            loadAppointmentTimeOptions(id, document.getElementById('aptTime').value);
        });
        document.getElementById('aptService').addEventListener('change', () => {
            loadAppointmentTimeOptions(id, document.getElementById('aptTime').value);
        });

    } catch (error) {
        alert(error.message);
    }
}

async function populateAppointmentServiceOptions(selectedServiceId) {
    const serviceSelect = document.getElementById('aptService');

    try {
        const services = state.services.length > 0 ? state.services : await fetchAdminServices();
        const activeServices = services.filter(service =>
            service.is_active !== false || String(service.id) === String(selectedServiceId)
        );

        serviceSelect.innerHTML = activeServices.map(service =>
            `<option value="${service.id}" ${String(service.id) === String(selectedServiceId) ? 'selected' : ''}>${escapeHtml(service.name)} (${service.duration || service.duration_minutes}分)${service.is_active === false ? ' [無効]' : ''}</option>`
        ).join('');
        serviceSelect.disabled = activeServices.length === 0;

        if (activeServices.length === 0) {
            serviceSelect.innerHTML = '<option value="">利用可能なメニューがありません</option>';
        }
    } catch (error) {
        serviceSelect.innerHTML = `<option value="">${escapeHtml(error.message || 'メニュー取得エラー')}</option>`;
        serviceSelect.disabled = false;
    }
}

async function loadAppointmentTimeOptions(appointmentId, preferredTime = '') {
    const requestId = ++state.editSlotsRequestId;
    const dateInput = document.getElementById('aptDate');
    const serviceSelect = document.getElementById('aptService');
    const timeSelect = document.getElementById('aptTime');

    if (!dateInput || !serviceSelect || !timeSelect) {
        return;
    }

    const dateStr = dateInput.value;
    const serviceId = serviceSelect.value;
    const originalStartDate = state.editingAppointment ? new Date(state.editingAppointment.startAt) : null;
    const originalDateStr = originalStartDate ? formatDate(originalStartDate) : '';
    const originalTimeStr = originalStartDate ? formatTimeValue(originalStartDate) : '';
    const isOriginalSlotSelection = state.editingAppointment
        && String(state.editingAppointment.id) === String(appointmentId)
        && dateStr === originalDateStr
        && String(serviceId) === String(state.editingAppointment.serviceId);

    if (!dateStr || !serviceId) {
        timeSelect.innerHTML = '<option value="">開始時間を選択してください</option>';
        timeSelect.disabled = true;
        return;
    }

    try {
        const cachedResult = getCachedAdminSlots(dateStr, serviceId, { excludeAppointmentId: appointmentId });
        if (!cachedResult) {
            timeSelect.innerHTML = '<option value="">読み込み中...</option>';
            timeSelect.disabled = true;
        }

        const result = cachedResult || await fetchAdminSlots(dateStr, serviceId, { excludeAppointmentId: appointmentId });
        if (requestId !== state.editSlotsRequestId) {
            return;
        }
        const slots = result.slots || [];

        timeSelect.innerHTML = '';
        timeSelect.disabled = false;

        // 管理者は全スロット選択可能（満席制限なし）
        slots.forEach(slot => {
            const opt = document.createElement('option');
            opt.value = slot.time;
            opt.textContent = slot.time;
            timeSelect.appendChild(opt);
        });

        if (isOriginalSlotSelection && originalTimeStr && !timeSelect.querySelector(`option[value="${originalTimeStr}"]`)) {
            timeSelect.innerHTML += `<option value="${originalTimeStr}">${originalTimeStr}（現在の予約）</option>`;
        }

        if (!timeSelect.options.length) {
            timeSelect.innerHTML = '<option value="">空き枠なし</option>';
            return;
        }

        if (isOriginalSlotSelection && originalTimeStr && timeSelect.querySelector(`option[value="${originalTimeStr}"]`)) {
            timeSelect.value = originalTimeStr;
        } else {
            selectNearestTime(timeSelect, preferredTime);
        }
    } catch (error) {
        console.error('編集用空き枠取得エラー:', error);
        timeSelect.innerHTML = `<option value="">${escapeHtml(error.message || '取得エラー')}</option>`;
        timeSelect.disabled = false;
    }
}

async function updateAppointment(id) {
    const dateStr = document.getElementById('aptDate').value;
    const timeStr = document.getElementById('aptTime').value;
    const serviceId = document.getElementById('aptService').value;
    const status = document.getElementById('aptStatus').value;
    const notes = document.getElementById('aptNotes').value;
    const originalAppointment = state.editingAppointment;

    if (!dateStr || !timeStr || !serviceId) {
        alert('日時とメニューを入力してください');
        return;
    }

    const payload = { status, notes };

    if (originalAppointment) {
        const originalStartDate = new Date(originalAppointment.startAt);
        const originalDateStr = formatDate(originalStartDate);
        const originalTimeStr = formatTimeValue(originalStartDate);
        const hasScheduleChange =
            dateStr !== originalDateStr ||
            timeStr !== originalTimeStr ||
            String(serviceId) !== String(originalAppointment.serviceId);

        if (hasScheduleChange) {
            payload.startAt = `${dateStr}T${timeStr}:00+09:00`;
            payload.serviceId = parseInt(serviceId, 10);
        }
    }

    try {
        await api(`/api/admin/appointments/${id}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
        });

        invalidateAppointmentDependentCaches();
        closeModal();
        loadCalendar();
        loadAppointments();

    } catch (error) {
        alert(error.message);
    }
}

function closeModal() {
    state.editingAppointment = null;
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
        if (!search) {
            state.recentPatients = patients;
        }
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

// ===== 新着予約通知（ポーリング＋バッジ） =====

let _pollingTimer = null;
let _lastCheckedAt = null;
let _pendingNotifications = []; // 未読通知リスト

function startAppointmentPolling() {
    _lastCheckedAt = new Date().toISOString();
    if (_pollingTimer) clearInterval(_pollingTimer);
    _pollingTimer = setInterval(pollNewAppointments, 30000);

    // ベルボタンのクリックイベント（初回のみ設定）
    const bell = document.getElementById('notificationBell');
    const dropdown = document.getElementById('notificationDropdown');
    if (bell && !bell._initialized) {
        bell._initialized = true;
        bell.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('open');
            if (dropdown.classList.contains('open')) {
                renderNotifDropdown();
            }
        });
        document.addEventListener('click', () => dropdown.classList.remove('open'));
        document.getElementById('notifClearBtn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            _pendingNotifications = [];
            updateNotifBadge();
            dropdown.classList.remove('open');
        });
    }
}

async function pollNewAppointments() {
    if (!state.isLoggedIn || !_lastCheckedAt) return;
    try {
        const since = _lastCheckedAt;
        _lastCheckedAt = new Date().toISOString();
        const appointments = await api(`/api/admin/appointments/recent?since=${encodeURIComponent(since)}`);
        if (appointments && appointments.length > 0) {
            appointments.forEach(apt => _pendingNotifications.unshift(apt));
            updateNotifBadge();
            invalidateAppointmentDependentCaches();
            loadCalendar();
            loadAppointments();
            loadPatients();
        }
    } catch (e) {
        // ネットワークエラー等は無視
    }
}

function updateNotifBadge() {
    const badge = document.getElementById('notificationBadge');
    if (!badge) return;
    const count = _pendingNotifications.length;
    badge.textContent = count > 9 ? '9+' : count;
    badge.style.display = count > 0 ? 'flex' : 'none';
}

function renderNotifDropdown() {
    const list = document.getElementById('notifList');
    if (!list) return;
    if (_pendingNotifications.length === 0) {
        list.innerHTML = '<div class="notif-empty">新着予約はありません</div>';
        return;
    }
    list.innerHTML = _pendingNotifications.map((apt, i) => {
        // start_at はUTC→JSTに変換して表示
        const jst = new Date(new Date(apt.start_at).getTime() + 9 * 60 * 60 * 1000);
        const time = `${String(jst.getUTCHours()).padStart(2,'0')}:${String(jst.getUTCMinutes()).padStart(2,'0')}`;
        const dateLabel = `${jst.getUTCMonth()+1}/${jst.getUTCDate()}（${['日','月','火','水','木','金','土'][jst.getUTCDay()]}）`;
        return `<div class="notif-item" data-index="${i}">
            <div class="notif-item-name">🦷 ${escapeHtml(apt.patient_name)}</div>
            <div class="notif-item-detail">${dateLabel} ${time}〜 ${escapeHtml(apt.service_name)}</div>
        </div>`;
    }).join('');

    list.querySelectorAll('.notif-item').forEach(item => {
        item.addEventListener('click', () => {
            // カレンダータブへ移動
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            const calTab = document.querySelector('.tab[data-tab="calendar"]');
            if (calTab) {
                calTab.classList.add('active');
                document.getElementById('calendarTab')?.classList.add('active');
            }
            _pendingNotifications = [];
            updateNotifBadge();
            document.getElementById('notificationDropdown')?.classList.remove('open');
        });
    });
}

// ===== ユーティリティ =====

// サービスIDに対応するカラーパレット
const SERVICE_COLOR_PALETTE = [
    '#B5843A', // amber（デフォルト）
    '#2980B9', // blue
    '#8E44AD', // purple
    '#E67E22', // orange
    '#C0392B', // red
    '#27AE60', // green
    '#16A085', // teal
    '#D35400', // burnt orange
    '#6C5CE7', // violet
    '#2C3E50', // dark slate
];

function getServiceColor(serviceId) {
    if (!serviceId) return SERVICE_COLOR_PALETTE[0];
    return SERVICE_COLOR_PALETTE[(serviceId - 1) % SERVICE_COLOR_PALETTE.length];
}

/**
 * preferredTime（HH:MM）に最も近い（以降の）選択肢を選ぶ。
 * 完全一致がなければ preferredTime 以降で最初のオプション、
 * それもなければ先頭のオプションを選択する。
 */
function selectNearestTime(timeSelect, preferredTime) {
    if (!preferredTime) {
        timeSelect.selectedIndex = 0;
        return;
    }
    if (timeSelect.querySelector(`option[value="${preferredTime}"]`)) {
        timeSelect.value = preferredTime;
        return;
    }
    // preferredTime 以降で最初の空き枠
    const options = Array.from(timeSelect.options);
    const nearest = options.find(opt => opt.value && opt.value >= preferredTime);
    if (nearest) {
        timeSelect.value = nearest.value;
    } else {
        timeSelect.selectedIndex = 0;
    }
}

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

function formatTimeValue(date) {
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

async function loadBusinessHours(forceRefresh = false) {
    try {
        const supportData = await ensureCalendarSupportData(forceRefresh);
        renderBusinessHoursTable(supportData.businessHours || []);
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



// デバッグ: 全患者削除
document.getElementById('debugClearPatients')?.addEventListener('click', async () => {
    if (!confirm('本当に全ての患者データを削除しますか？\n\n【警告】\n患者に関連する「予約データ」も全て削除されます。\nこの操作は取り消せません。')) {
        return;
    }

    try {
        const result = await api('/api/admin/debug/patients', {
            method: 'DELETE'
        });
        alert(result.message);
        // カレンダーと患者リスト再読み込みの必要があるが、リロードを推奨
        location.reload();
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
        'btn-primary'
    );

    if (!confirmed) return;

    const row = document.querySelector(`#doctorsTable tr[data-id="${id}"]`);
    if (row) row.remove();

    try {
        await api(`/api/admin/staff/${id}`, { method: 'DELETE' });
    } catch (error) {
        loadDoctors();
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

    const row = document.querySelector(`#accountsTable .delete-account-btn[data-id="${id}"]`)?.closest('tr');
    if (row) row.remove();

    try {
        await api(`/api/admin/accounts/${id}`, { method: 'DELETE' });
    } catch (error) {
        loadAccounts();
        alert(error.message);
    }
}

window.deleteAccount = deleteAccount;

// ===== メニュー管理 =====
async function fetchAdminServices(forceRefresh = false) {
    if (!forceRefresh && state.services.length > 0) {
        return state.services;
    }

    if (!forceRefresh && state.servicesPromise) {
        return state.servicesPromise;
    }

    state.servicesPromise = api('/api/admin/services')
        .then((services) => {
            state.services = services;
            return services;
        })
        .finally(() => {
            state.servicesPromise = null;
        });

    return state.servicesPromise;
}

async function loadServices(forceRefresh = false) {
    try {
        const services = await fetchAdminServices(forceRefresh);
        renderServicesTable(services);
        return services;
    } catch (error) {
        console.error('メニュー一覧読み込みエラー:', error);
        return [];
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

        loadServices(true);
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

    const row = document.querySelector(`#servicesTable tr[data-id="${id}"]`);
    if (row) row.remove();
    state.services = state.services.filter(s => String(s.id) !== String(id));

    try {
        await api(`/api/admin/services/${id}`, { method: 'DELETE' });
    } catch (error) {
        loadServices(true);
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
        loadServices(true);
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
                invalidateScheduleDependentCaches();
                await Promise.all([
                    loadBusinessHours(),
                    loadScheduleExceptions(),
                    loadCalendar()
                ]);
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

async function loadScheduleExceptions(forceRefresh = false) {
    try {
        const supportData = await ensureCalendarSupportData(forceRefresh);
        renderScheduleExceptionsTable(supportData.scheduleExceptions || []);
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

        invalidateScheduleDependentCaches();
        await Promise.all([
            loadScheduleExceptions(),
            loadCalendar()
        ]);
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

    const row = document.querySelector(`#scheduleExceptionsTable .delete-exception-btn[data-id="${id}"]`)?.closest('tr');
    if (row) row.remove();

    try {
        await api(`/api/admin/schedule-exceptions/${id}`, { method: 'DELETE' });
        invalidateScheduleDependentCaches();
        loadCalendar(); // バックグラウンドで更新
    } catch (error) {
        loadScheduleExceptions();
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
        invalidateAppointmentDependentCaches();
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
const createPatientNameInput = document.getElementById('newAptName');

// ボタンイベント
document.getElementById('newAppointmentBtn')?.addEventListener('click', () => openCreateModal());
document.getElementById('openCreateModalBtn')?.addEventListener('click', () => openCreateModal());
document.getElementById('closeCreateModal')?.addEventListener('click', closeCreateModal);
document.getElementById('createModalCancel')?.addEventListener('click', closeCreateModal);
createPatientNameInput?.addEventListener('click', () => loadCreatePatientSuggestions(createPatientNameInput.value));
createPatientNameInput?.addEventListener('input', handleCreatePatientNameInput);

document.getElementById('createModalSave')?.addEventListener('click', async () => {
    if (createForm.checkValidity()) {
        await createAppointment();
    } else {
        createForm.reportValidity();
    }
});

function handleCreatePatientNameInput() {
    if (state.patientSearchTimer) {
        clearTimeout(state.patientSearchTimer);
    }

    if (state.selectedCreatePatient && createPatientNameInput.value.trim() !== state.selectedCreatePatient.name) {
        clearCreatePatientSelection({ keepName: true });
    }

    state.patientSearchTimer = setTimeout(() => {
        loadCreatePatientSuggestions(createPatientNameInput.value);
    }, createPatientNameInput.value.trim() ? 150 : 0);
}

async function fetchRecentPatients(forceRefresh = false) {
    if (!forceRefresh && state.recentPatients.length > 0) {
        return state.recentPatients;
    }

    const patients = await api('/api/admin/patients');
    state.recentPatients = patients;
    return patients;
}

async function loadCreatePatientSuggestions(rawQuery = '') {
    const query = rawQuery.trim();
    const requestId = ++state.patientSearchRequestId;

    try {
        let patients;
        if (query) {
            patients = await api(`/api/admin/patients?search=${encodeURIComponent(query)}`);
        } else {
            patients = await fetchRecentPatients();
        }

        if (requestId !== state.patientSearchRequestId) {
            return;
        }

        state.createPatientSuggestions = patients.slice(0, 8);
        renderCreatePatientSuggestions(state.createPatientSuggestions, query);
    } catch (error) {
        console.error('患者候補取得エラー:', error);
    }
}

function renderCreatePatientSuggestions(patients, query = '') {
    const suggestionBox = document.getElementById('newAptPatientSuggestions');

    if (!createModal.classList.contains('active')) {
        return;
    }

    if (state.selectedCreatePatient && createPatientNameInput.value.trim() === state.selectedCreatePatient.name) {
        suggestionBox.style.display = 'none';
        return;
    }

    if (patients.length === 0) {
        suggestionBox.innerHTML = `<div class="patient-suggestion-empty">${query ? '一致する患者がいません' : '登録済み患者はいません'}</div>`;
        suggestionBox.style.display = 'block';
        return;
    }

    suggestionBox.innerHTML = patients.map(patient => {
        const meta = [
            patient.phone ? `TEL: ${escapeHtml(patient.phone)}` : '電話番号未登録',
            patient.appointment_count ? `来院${patient.appointment_count}回` : '来院履歴なし'
        ].join(' / ');

        return `
            <button type="button" class="patient-suggestion-item" data-id="${patient.id}">
                <div class="patient-suggestion-name">${escapeHtml(patient.name)}</div>
                <div class="patient-suggestion-meta">${meta}</div>
            </button>
        `;
    }).join('');
    suggestionBox.style.display = 'block';
}

function hideCreatePatientSuggestions() {
    const suggestionBox = document.getElementById('newAptPatientSuggestions');
    suggestionBox.style.display = 'none';
}

function setCreatePatientSelection(patient) {
    state.selectedCreatePatient = patient;
    document.getElementById('newAptPatientId').value = patient.id;
    createPatientNameInput.value = patient.name;

    const selection = document.getElementById('newAptPatientSelection');
    const selectionText = document.getElementById('newAptPatientSelectionText');
    const meta = patient.phone ? ` / ${patient.phone}` : '';
    selectionText.textContent = `既存患者として登録します: ${patient.name}${meta}`;
    selection.style.display = 'flex';

    hideCreatePatientSuggestions();
}

function clearCreatePatientSelection(options = {}) {
    const { keepName = false } = options;
    state.selectedCreatePatient = null;
    document.getElementById('newAptPatientId').value = '';
    document.getElementById('newAptPatientSelection').style.display = 'none';
    document.getElementById('newAptPatientSelectionText').textContent = '';

    if (!keepName) {
        createPatientNameInput.value = '';
    }
}

function selectCreatePatientById(patientId) {
    const patient = state.createPatientSuggestions.find(item => String(item.id) === String(patientId))
        || state.recentPatients.find(item => String(item.id) === String(patientId));

    if (!patient) {
        return;
    }

    setCreatePatientSelection(patient);
}

async function openCreateModal(options = {}) {
    const dateInput = document.getElementById('newAptDate');
    const serviceSelect = document.getElementById('newAptService');
    const timeSelect = document.getElementById('newAptTime');
    const now = new Date();
    const requestedDate = options.date || formatDate(now);
    const roundedMinutes = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 30) * 30;
    const defaultTime = `${String(Math.floor(roundedMinutes / 60)).padStart(2, '0')}:${String(roundedMinutes % 60).padStart(2, '0')}`;
    const preferredTime = options.time || defaultTime;

    createModal.classList.add('active');
    dateInput.value = requestedDate;
    clearCreatePatientSelection();
    createPatientNameInput.focus();

    if (state.services.length > 0) {
        populateCreateServiceOptions(state.services);
    } else {
        serviceSelect.innerHTML = '<option value="">読み込み中...</option>';
        serviceSelect.disabled = true;
    }

    timeSelect.innerHTML = '<option value="">読み込み中...</option>';
    timeSelect.disabled = true;

    try {
        const services = state.services.length > 0 ? state.services : await fetchAdminServices();
        populateCreateServiceOptions(services);
        if (options.time) {
            const matchingServiceId = findCreateServiceForPreferredTime(requestedDate, preferredTime, services);
            if (matchingServiceId) {
                serviceSelect.value = matchingServiceId;
            }
        }
        await updateAvailableTimes({ preferredTime });
    } catch (error) {
        console.error('メニュー読み込みエラー:', error);
        serviceSelect.innerHTML = `<option value="">${escapeHtml(error.message || 'メニューの読み込みに失敗しました')}</option>`;
        serviceSelect.disabled = false;
        timeSelect.innerHTML = '<option value="">メニューを選択してください</option>';
        timeSelect.disabled = true;
    }
}

function populateCreateServiceOptions(services) {
    const serviceSelect = document.getElementById('newAptService');
    const activeServices = services.filter(service => service.is_active !== false);

    if (activeServices.length === 0) {
        serviceSelect.innerHTML = '<option value="">利用可能なメニューがありません</option>';
        serviceSelect.disabled = true;
        return;
    }

    serviceSelect.innerHTML = activeServices.map(service =>
        `<option value="${service.id}">${escapeHtml(service.name)} (${service.duration || service.duration_minutes}分)</option>`
    ).join('');
    serviceSelect.disabled = false;
}

function findCreateServiceForPreferredTime(dateStr, preferredTime, services) {
    const activeServices = services.filter(service => service.is_active !== false);
    if (!dateStr || !preferredTime || activeServices.length === 0) {
        return null;
    }

    const primaryService = activeServices[0];
    if (doesServiceFitCalendarSchedule(dateStr, preferredTime, primaryService.duration || primaryService.duration_minutes)) {
        return String(primaryService.id);
    }

    return activeServices
        .slice()
        .sort((a, b) =>
            (a.duration || a.duration_minutes) - (b.duration || b.duration_minutes)
            || (a.sort_order || 0) - (b.sort_order || 0)
            || a.id - b.id
        )
        .find(service => doesServiceFitCalendarSchedule(dateStr, preferredTime, service.duration || service.duration_minutes))?.id?.toString() || null;
}

function closeCreateModal() {
    createModal.classList.remove('active');
    if (state.patientSearchTimer) {
        clearTimeout(state.patientSearchTimer);
        state.patientSearchTimer = null;
    }
    state.createPatientSuggestions = [];
    hideCreatePatientSuggestions();
    clearCreatePatientSelection();
    createForm.reset();
}

async function createAppointment() {
    const patientIdValue = document.getElementById('newAptPatientId').value;
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
            body: JSON.stringify({
                patientId: patientIdValue ? parseInt(patientIdValue, 10) : null,
                name,
                startAt,
                serviceId,
                notes
            })
        });

        invalidateAppointmentDependentCaches();
        closeCreateModal();
        loadCalendar();
        loadAppointments();
        loadPatients();

    } catch (error) {
        alert(error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

// 日付・メニュー変更時に空き枠を再取得
document.getElementById('newAptDate')?.addEventListener('change', () => updateAvailableTimes());
document.getElementById('newAptService')?.addEventListener('change', () => updateAvailableTimes());

async function updateAvailableTimes(options = {}) {
    const requestId = ++state.createSlotsRequestId;
    const dateStr = document.getElementById('newAptDate').value;
    const serviceId = document.getElementById('newAptService').value;
    const timeSelect = document.getElementById('newAptTime');
    const preferredTime = options.preferredTime || timeSelect.value;

    if (!dateStr || !serviceId) return;

    try {
        const cachedResult = getCachedAdminSlots(dateStr, serviceId);
        if (!cachedResult) {
            timeSelect.innerHTML = '<option value="">読み込み中...</option>';
            timeSelect.disabled = true;
        }

        const result = cachedResult || await fetchAdminSlots(dateStr, serviceId);
        if (requestId !== state.createSlotsRequestId) {
            return;
        }
        const slots = result.slots || [];

        timeSelect.innerHTML = '';
        timeSelect.disabled = false;

        if (slots.length === 0) {
            timeSelect.innerHTML = '<option value="">空き枠なし</option>';
            return;
        }

        // 管理者は全スロット選択可能（満席制限なし）
        slots.forEach(slot => {
            const opt = document.createElement('option');
            opt.value = slot.time;
            opt.textContent = slot.time;
            timeSelect.appendChild(opt);
        });

        selectNearestTime(timeSelect, preferredTime);

    } catch (error) {
        console.error('空き枠取得エラー:', error);
        timeSelect.innerHTML = `<option value="">${escapeHtml(error.message || '取得エラー')}</option>`;
        timeSelect.disabled = false;
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

        // 再取得せずローカル状態を更新して再描画
        capacitySettings.capacities = capacities
            .filter(c => c.capacity !== null)
            .map(c => ({ day_of_week: c.dayOfWeek, time_slot: c.timeSlot, capacity: c.capacity }));
        renderCapacityMatrix();
        showCapacityAlert('success', 'キャパシティ設定を保存しました');
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

    // 特定日設定が1件でもあれば削除ボタンを表示、グリッド本体も表示
    const hasDateSpecific = capacities.some(item => item.source === 'date');
    const deleteBtn = document.getElementById('deleteDateCapacity');
    if (deleteBtn) deleteBtn.style.display = hasDateSpecific ? '' : 'none';
    const gridWrapper = container.parentElement;
    if (gridWrapper) gridWrapper.style.display = 'block';

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

    // 即時UI更新（API完了を待たない）
    inputs.forEach(input => {
        input.style.background = '#e0f2fe';
        input.style.borderColor = '#0284c7';
    });
    const deleteBtn = document.getElementById('deleteDateCapacity');
    if (deleteBtn) deleteBtn.style.display = '';

    try {
        await api(`/api/admin/slot-capacities/date/${date}`, {
            method: 'PUT',
            body: JSON.stringify({ capacities })
        });

        showCapacityAlert('success', `${date} の設定を保存しました`);
    } catch (error) {
        showCapacityAlert('error', error.message);
    }
});

document.getElementById('deleteDateCapacity')?.addEventListener('click', async (e) => {
    const date = document.getElementById('capacityDateInput').value;
    if (!date) return;
    if (!confirm(`${date} の個別設定を削除して曜日設定に戻しますか？`)) return;

    const btn = e.currentTarget;
    const grid = document.getElementById('dateCapacityGrid');
    const gridWrapper = grid?.parentElement;
    btn.style.display = 'none';
    if (gridWrapper) gridWrapper.style.display = 'none';

    try {
        await api(`/api/admin/slot-capacities/date/${date}`, { method: 'DELETE' });
        showCapacityAlert('success', `${date} の個別設定を削除しました`);
        // 再取得不要 - グリッドは非表示のまま維持
    } catch (error) {
        btn.style.display = '';
        if (gridWrapper) gridWrapper.style.display = '';
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
