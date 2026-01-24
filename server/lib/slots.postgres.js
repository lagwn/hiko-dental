/**
 * 空き枠生成ロジック (PostgreSQL版)
 */

const db = require('../db/db');

/**
 * 指定日の空き時間スロットを取得
 */
async function getAvailableSlots(dateStr, serviceId, staffId, settings) {
    const now = new Date();
    const targetDate = new Date(dateStr);

    // 日付の妥当性チェック
    if (isNaN(targetDate.getTime())) {
        return { error: '無効な日付です', slots: [] };
    }

    // 予約可能期間チェック
    const cutoffDays = parseInt(settings.booking_cutoff_days) || 2;
    const cutoffHours = parseInt(settings.booking_cutoff_hours) || 3;
    const maxDaysAhead = parseInt(settings.booking_max_days_ahead) || 60;

    // 最遠予約日チェック
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + maxDaysAhead);
    maxDate.setHours(23, 59, 59, 999);

    if (targetDate > maxDate) {
        return { error: `予約は${maxDaysAhead}日先までです`, slots: [] };
    }

    // 予約締切チェック
    const cutoffDate = new Date(targetDate);
    cutoffDate.setDate(cutoffDate.getDate() - cutoffDays);
    cutoffDate.setHours(23 - cutoffHours, 59, 59, 999);

    if (now > cutoffDate) {
        return { error: `この日の予約受付は終了しました（${cutoffDays}日前 ${24 - cutoffHours}:00まで）`, slots: [] };
    }

    // 休診日チェック
    const holiday = await db.queryOne(`
        SELECT * FROM holidays WHERE date = $1
    `, [dateStr]);

    if (holiday) {
        return { error: `${holiday.name || '休診日'}のため予約できません`, slots: [] };
    }

    // 曜日の営業時間取得
    const dayOfWeek = targetDate.getDay();
    const businessHours = await db.queryOne(`
        SELECT * FROM business_hours WHERE day_of_week = $1
    `, [dayOfWeek]);

    if (!businessHours || businessHours.is_closed) {
        return { error: '休診日です', slots: [] };
    }

    // サービスの所要時間取得
    const service = await db.queryOne(`
        SELECT duration_minutes FROM services WHERE id = $1 AND is_active = true
    `, [serviceId]);

    if (!service) {
        return { error: '無効なメニューです', slots: [] };
    }

    const slotDuration = parseInt(settings.slot_duration_minutes) || 30;
    const serviceDuration = service.duration_minutes;

    // 昼休み
    const lunchStart = settings.lunch_start || '12:00';
    const lunchEnd = settings.lunch_end || '13:00';

    // スロット生成
    const slots = [];
    const [openHour, openMin] = businessHours.open_time.split(':').map(Number);
    const [closeHour, closeMin] = businessHours.close_time.split(':').map(Number);
    const [lunchStartHour, lunchStartMin] = lunchStart.split(':').map(Number);
    const [lunchEndHour, lunchEndMin] = lunchEnd.split(':').map(Number);

    let currentTime = new Date(targetDate);
    currentTime.setHours(openHour, openMin, 0, 0);

    const closeTime = new Date(targetDate);
    closeTime.setHours(closeHour, closeMin, 0, 0);

    const lunchStartTime = new Date(targetDate);
    lunchStartTime.setHours(lunchStartHour, lunchStartMin, 0, 0);

    const lunchEndTime = new Date(targetDate);
    lunchEndTime.setHours(lunchEndHour, lunchEndMin, 0, 0);

    // 既存予約取得
    let existingAppointments;
    if (staffId) {
        existingAppointments = await db.queryAll(`
            SELECT start_at, end_at, staff_id FROM appointments 
            WHERE DATE(start_at) = $1 AND status = 'confirmed'
            AND (staff_id = $2 OR staff_id IS NULL)
        `, [dateStr, staffId]);
    } else {
        existingAppointments = await db.queryAll(`
            SELECT start_at, end_at, staff_id FROM appointments 
            WHERE DATE(start_at) = $1 AND status = 'confirmed'
        `, [dateStr]);
    }

    while (currentTime < closeTime) {
        const slotEnd = new Date(currentTime.getTime() + serviceDuration * 60000);

        // 営業時間内かチェック
        if (slotEnd > closeTime) break;

        // 昼休みチェック
        const isLunchTime =
            (currentTime >= lunchStartTime && currentTime < lunchEndTime) ||
            (slotEnd > lunchStartTime && slotEnd <= lunchEndTime) ||
            (currentTime < lunchStartTime && slotEnd > lunchEndTime);

        if (!isLunchTime) {
            // 予約済みチェック
            const slotStartStr = formatDateTime(currentTime);
            const slotEndStr = formatDateTime(slotEnd);
            const timeSlotStr = formatTime(currentTime); // "09:00" 形式

            // この時間帯と重複する予約数をカウント
            const bookingCount = existingAppointments.filter(apt => {
                // スタッフ指名がある場合は、同じスタッフの予約のみチェック
                if (staffId && apt.staff_id && apt.staff_id !== staffId) {
                    return false;
                }
                // 時間重複チェック
                const aptStart = new Date(apt.start_at);
                const aptEnd = new Date(apt.end_at);
                return (currentTime < aptEnd && slotEnd > aptStart);
            }).length;

            // この時間枠のキャパシティを取得（個別設定 > デフォルト）
            const capacity = await getSlotCapacity(dayOfWeek, timeSlotStr, settings, dateStr);
            const isAvailable = bookingCount < capacity;

            // 現在時刻より後のスロットのみ追加
            const slotDateTime = new Date(currentTime);
            if (slotDateTime > now) {
                slots.push({
                    time: formatTime(currentTime),
                    start: formatTime(currentTime),
                    end: formatTime(slotEnd),
                    startAt: slotStartStr,
                    endAt: slotEndStr,
                    available: isAvailable,
                    bookingCount: bookingCount,
                    capacity: capacity
                });
            }
        }

        // 次のスロットへ
        currentTime.setMinutes(currentTime.getMinutes() + slotDuration);
    }

    return { slots, error: null };
}

/**
 * 予約可能な日付一覧を取得
 */
async function getAvailableDates(settings) {
    const now = new Date();
    const cutoffDays = parseInt(settings.booking_cutoff_days) || 2;
    const cutoffHours = parseInt(settings.booking_cutoff_hours) || 3;
    const maxDaysAhead = parseInt(settings.booking_max_days_ahead) || 60;

    const dates = [];

    // 休診日を一括取得
    const holidays = await db.queryAll(`SELECT date FROM holidays`);
    const holidayDates = new Set(holidays.map(h => {
        const d = new Date(h.date);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }));

    // 営業時間を一括取得
    const businessHoursAll = await db.queryAll(`SELECT * FROM business_hours`);
    const businessHoursMap = {};
    for (const bh of businessHoursAll) {
        businessHoursMap[bh.day_of_week] = bh;
    }

    // 今日から最遠日まで
    for (let i = 0; i <= maxDaysAhead; i++) {
        const date = new Date();
        date.setDate(date.getDate() + i);
        date.setHours(0, 0, 0, 0);

        const dateStr = formatDate(date);
        const dayOfWeek = date.getDay();

        // 予約締切チェック
        const cutoffDate = new Date(date);
        cutoffDate.setDate(cutoffDate.getDate() - cutoffDays);
        cutoffDate.setHours(23 - cutoffHours, 59, 59, 999);

        if (now > cutoffDate) {
            continue; // 締切過ぎ
        }

        // 休診日チェック
        if (holidayDates.has(dateStr)) continue;

        // 曜日の営業時間チェック
        const businessHours = businessHoursMap[dayOfWeek];

        if (!businessHours || businessHours.is_closed) {
            continue;
        }

        dates.push({
            date: dateStr,
            dayOfWeek: dayOfWeek,
            dayName: getDayName(dayOfWeek)
        });
    }

    return dates;
}

/**
 * 予約の有効性を検証（サーバーサイド）
 */
async function validateBooking(startAt, endAt, serviceId, staffId, settings) {
    const now = new Date();
    const startDate = new Date(startAt);
    const endDate = new Date(endAt);
    const dateStr = formatDate(startDate);

    // 日時の妥当性
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return { valid: false, error: '無効な日時です' };
    }

    if (startDate >= endDate) {
        return { valid: false, error: '終了時刻は開始時刻より後である必要があります' };
    }

    // 予約可能期間チェック
    const cutoffDays = parseInt(settings.booking_cutoff_days) || 2;
    const cutoffHours = parseInt(settings.booking_cutoff_hours) || 3;
    const maxDaysAhead = parseInt(settings.booking_max_days_ahead) || 60;

    // 最遠予約日チェック
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + maxDaysAhead);
    maxDate.setHours(23, 59, 59, 999);

    if (startDate > maxDate) {
        return { valid: false, error: `予約は${maxDaysAhead}日先までです` };
    }

    // 予約締切チェック
    const cutoffDate = new Date(startDate);
    cutoffDate.setDate(cutoffDate.getDate() - cutoffDays);
    cutoffDate.setHours(23 - cutoffHours, 59, 59, 999);

    if (now > cutoffDate) {
        return { valid: false, error: `この日の予約受付は終了しました` };
    }

    // 過去の日時チェック
    if (startDate <= now) {
        return { valid: false, error: '過去の日時は予約できません' };
    }

    // 休診日チェック
    const holiday = await db.queryOne(`
        SELECT * FROM holidays WHERE date = $1
    `, [dateStr]);

    if (holiday) {
        return { valid: false, error: '休診日のため予約できません' };
    }

    // 営業時間チェック
    const dayOfWeek = startDate.getDay();
    const businessHours = await db.queryOne(`
        SELECT * FROM business_hours WHERE day_of_week = $1
    `, [dayOfWeek]);

    if (!businessHours || businessHours.is_closed) {
        return { valid: false, error: '休診日です' };
    }

    // サービス存在チェック
    const service = await db.queryOne(`
        SELECT * FROM services WHERE id = $1 AND is_active = true
    `, [serviceId]);

    if (!service) {
        return { valid: false, error: '無効なメニューです' };
    }

    // スタッフ存在チェック（指名ありの場合）
    if (staffId) {
        const staff = await db.queryOne(`
            SELECT * FROM staff WHERE id = $1 AND is_active = true
        `, [staffId]);

        if (!staff) {
            return { valid: false, error: '無効な担当者です' };
        }
    }

    // 重複予約チェック
    let conflict;
    if (staffId) {
        conflict = await db.queryOne(`
            SELECT * FROM appointments 
            WHERE status = 'confirmed'
            AND start_at < $1 AND end_at > $2
            AND (staff_id = $3 OR staff_id IS NULL)
        `, [endAt, startAt, staffId]);
    } else {
        conflict = await db.queryOne(`
            SELECT * FROM appointments 
            WHERE status = 'confirmed'
            AND start_at < $1 AND end_at > $2
        `, [endAt, startAt]);
    }

    if (conflict) {
        return { valid: false, error: 'この時間帯は既に予約されています' };
    }

    return { valid: true, error: null };
}

/**
 * 指定時間枠のキャパシティを取得
 * 優先順位: 特定日設定 > 曜日設定 > デフォルト値
 */
async function getSlotCapacity(dayOfWeek, timeSlot, settings, dateStr = null) {
    // 1. 特定日の設定を確認（dateStrがある場合）
    if (dateStr) {
        const specificCapacity = await db.queryOne(`
            SELECT capacity FROM slot_capacities 
            WHERE specific_date = $1 AND time_slot = $2
        `, [dateStr, timeSlot]);

        if (specificCapacity) {
            return specificCapacity.capacity;
        }
    }

    // 2. 曜日設定を確認
    const dayCapacity = await db.queryOne(`
        SELECT capacity FROM slot_capacities 
        WHERE day_of_week = $1 AND time_slot = $2 AND specific_date IS NULL
    `, [dayOfWeek, timeSlot]);

    if (dayCapacity) {
        return dayCapacity.capacity;
    }

    // 3. デフォルト値を返す
    return parseInt(settings.default_slot_capacity) || 1;
}

// ヘルパー関数
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

function formatDateTime(date) {
    return date.toISOString();
}

function getDayName(dayOfWeek) {
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    return days[dayOfWeek];
}

module.exports = {
    getAvailableSlots,
    getAvailableDates,
    validateBooking,
    getSlotCapacity,
    formatDate,
    formatTime,
    formatDateTime
};
