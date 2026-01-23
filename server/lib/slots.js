/**
 * 空き枠生成ロジック
 */

/**
 * 指定日の空き時間スロットを取得
 * @param {Database} db - データベース接続
 * @param {string} dateStr - 日付文字列（YYYY-MM-DD）
 * @param {number} serviceId - サービスID
 * @param {number|null} staffId - スタッフID（null=指名なし）
 * @param {Object} settings - システム設定
 * @returns {Array} 空きスロット配列
 */
function getAvailableSlots(db, dateStr, serviceId, staffId, settings) {
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
    const holiday = db.prepare(`
        SELECT * FROM holidays WHERE date = ?
    `).get(dateStr);

    if (holiday) {
        return { error: `${holiday.name || '休診日'}のため予約できません`, slots: [] };
    }

    // スケジュール例外チェック（臨時休業、時間帯変更など）
    const scheduleException = db.prepare(`
        SELECT * FROM schedule_exceptions 
        WHERE ? BETWEEN start_date AND end_date
        ORDER BY 
            CASE exception_type 
                WHEN 'closed' THEN 1 
                WHEN 'partial_closed' THEN 2 
                WHEN 'modified_hours' THEN 3 
                WHEN 'special_open' THEN 4 
            END
        LIMIT 1
    `).get(dateStr);

    // 終日休業の場合
    if (scheduleException && scheduleException.exception_type === 'closed') {
        return { error: `${scheduleException.reason || '臨時休業'}のため予約できません`, slots: [] };
    }

    // 曜日の営業時間取得
    const dayOfWeek = targetDate.getDay();
    let businessHours = db.prepare(`
        SELECT * FROM business_hours WHERE day_of_week = ?
    `).get(dayOfWeek);

    // 特別営業（通常休診日だが臨時で営業）の場合
    if (scheduleException && scheduleException.exception_type === 'special_open') {
        // 営業時間を例外の設定で上書き
        businessHours = {
            ...businessHours,
            is_closed: 0,
            morning_open: scheduleException.morning_open || businessHours?.morning_open,
            morning_close: scheduleException.morning_close || businessHours?.morning_close,
            afternoon_open: scheduleException.afternoon_open || businessHours?.afternoon_open,
            afternoon_close: scheduleException.afternoon_close || businessHours?.afternoon_close
        };
    }
    // 営業時間変更の場合
    else if (scheduleException && scheduleException.exception_type === 'modified_hours') {
        businessHours = {
            ...businessHours,
            is_closed: 0,
            morning_open: scheduleException.morning_open,
            morning_close: scheduleException.morning_close,
            afternoon_open: scheduleException.afternoon_open,
            afternoon_close: scheduleException.afternoon_close
        };
    }

    if (!businessHours || businessHours.is_closed) {
        return { error: '休診日です', slots: [] };
    }

    // サービスの所要時間取得
    const service = db.prepare(`
        SELECT duration_minutes FROM services WHERE id = ? AND is_active = 1
    `).get(serviceId);

    if (!service) {
        return { error: '無効なメニューです', slots: [] };
    }

    const slotDuration = parseInt(settings.slot_duration_minutes) || 30;
    const serviceDuration = service.duration_minutes;

    // 既存予約取得
    const existingAppointments = db.prepare(`
        SELECT start_at, end_at, staff_id FROM appointments 
        WHERE DATE(start_at) = ? AND status = 'confirmed'
        ${staffId ? 'AND (staff_id = ? OR staff_id IS NULL)' : ''}
    `).all(staffId ? [dateStr, staffId] : [dateStr]);

    // スロット生成（午前・午後それぞれ）
    const slots = [];
    const timePeriods = [];

    // 午前の時間帯
    if (businessHours.morning_open && businessHours.morning_close) {
        timePeriods.push({
            open: businessHours.morning_open,
            close: businessHours.morning_close
        });
    }

    // 午後の時間帯
    if (businessHours.afternoon_open && businessHours.afternoon_close) {
        timePeriods.push({
            open: businessHours.afternoon_open,
            close: businessHours.afternoon_close
        });
    }

    // 旧形式との互換性（午前・午後が設定されていない場合）
    if (timePeriods.length === 0 && businessHours.open_time && businessHours.close_time) {
        timePeriods.push({
            open: businessHours.open_time,
            close: businessHours.close_time
        });
    }

    for (const period of timePeriods) {
        const [openHour, openMin] = period.open.split(':').map(Number);
        const [closeHour, closeMin] = period.close.split(':').map(Number);

        let currentTime = new Date(targetDate);
        currentTime.setHours(openHour, openMin, 0, 0);

        const closeTime = new Date(targetDate);
        closeTime.setHours(closeHour, closeMin, 0, 0);

        while (currentTime < closeTime) {
            const slotEnd = new Date(currentTime.getTime() + serviceDuration * 60000);

            // 営業時間内かチェック
            if (slotEnd > closeTime) break;

            // 予約済みチェック
            const slotStartStr = formatDateTime(currentTime);
            const slotEndStr = formatDateTime(slotEnd);

            const isBooked = existingAppointments.some(apt => {
                if (staffId && apt.staff_id && apt.staff_id !== staffId) {
                    return false;
                }
                return (slotStartStr < apt.end_at && slotEndStr > apt.start_at);
            });

            // 時間帯休業チェック（partial_closed）
            let isInClosedPeriod = false;
            if (scheduleException && scheduleException.exception_type === 'partial_closed') {
                const closedStart = scheduleException.start_time;
                const closedEnd = scheduleException.end_time;
                if (closedStart && closedEnd) {
                    const slotStart = formatTime(currentTime);
                    const slotEndTime = formatTime(slotEnd);
                    // スロットが休業時間帯と重なるかチェック
                    if (slotStart < closedEnd && slotEndTime > closedStart) {
                        isInClosedPeriod = true;
                    }
                }
            }

            // 現在時刻より後のスロットのみ追加
            if (!isBooked && !isInClosedPeriod && currentTime > now) {
                slots.push({
                    start: formatTime(currentTime),
                    end: formatTime(slotEnd),
                    startAt: slotStartStr,
                    endAt: slotEndStr,
                    available: true
                });
            }

            currentTime.setMinutes(currentTime.getMinutes() + slotDuration);
        }
    }

    return { slots, error: null };
}

/**
 * 予約可能な日付一覧を取得
 * @param {Database} db - データベース接続
 * @param {Object} settings - システム設定
 * @returns {Array} 予約可能な日付配列
 */
function getAvailableDates(db, settings) {
    const now = new Date();
    const cutoffDays = parseInt(settings.booking_cutoff_days) || 2;
    const cutoffHours = parseInt(settings.booking_cutoff_hours) || 3;
    const maxDaysAhead = parseInt(settings.booking_max_days_ahead) || 60;

    const dates = [];

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
        const holiday = db.prepare(`
            SELECT * FROM holidays WHERE date = ?
        `).get(dateStr);

        if (holiday) continue;

        // スケジュール例外チェック
        const scheduleException = db.prepare(`
            SELECT * FROM schedule_exceptions 
            WHERE ? BETWEEN start_date AND end_date
            AND exception_type = 'closed'
        `).get(dateStr);

        // 終日休業の場合はスキップ
        if (scheduleException) continue;

        // 特別営業日チェック（通常休診日でも営業）
        const specialOpen = db.prepare(`
            SELECT * FROM schedule_exceptions 
            WHERE ? BETWEEN start_date AND end_date
            AND exception_type = 'special_open'
        `).get(dateStr);

        // 曜日の営業時間チェック
        const businessHours = db.prepare(`
            SELECT * FROM business_hours WHERE day_of_week = ?
        `).get(dayOfWeek);

        // 通常休診日だが特別営業の場合は追加
        if ((!businessHours || businessHours.is_closed) && !specialOpen) {
            continue;
        }

        dates.push({
            date: dateStr,
            dayOfWeek: dayOfWeek,
            dayName: getDayName(dayOfWeek),
            hasException: !!scheduleException || !!specialOpen
        });
    }

    return dates;
}

/**
 * 予約の有効性を検証（サーバーサイド）
 * @param {Database} db - データベース接続
 * @param {string} startAt - 開始日時
 * @param {string} endAt - 終了日時
 * @param {number} serviceId - サービスID
 * @param {number|null} staffId - スタッフID
 * @param {Object} settings - システム設定
 * @returns {{valid: boolean, error: string|null}}
 */
function validateBooking(db, startAt, endAt, serviceId, staffId, settings) {
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
    const holiday = db.prepare(`
        SELECT * FROM holidays WHERE date = ?
    `).get(dateStr);

    if (holiday) {
        return { valid: false, error: '休診日のため予約できません' };
    }

    // 営業時間チェック
    const dayOfWeek = startDate.getDay();
    const businessHours = db.prepare(`
        SELECT * FROM business_hours WHERE day_of_week = ?
    `).get(dayOfWeek);

    if (!businessHours || businessHours.is_closed) {
        return { valid: false, error: '休診日です' };
    }

    // サービス存在チェック
    const service = db.prepare(`
        SELECT * FROM services WHERE id = ? AND is_active = 1
    `).get(serviceId);

    if (!service) {
        return { valid: false, error: '無効なメニューです' };
    }

    // スタッフ存在チェック（指名ありの場合）
    if (staffId) {
        const staff = db.prepare(`
            SELECT * FROM staff WHERE id = ? AND is_active = 1
        `).get(staffId);

        if (!staff) {
            return { valid: false, error: '無効な担当者です' };
        }
    }

    // 重複予約チェック
    const conflict = db.prepare(`
        SELECT * FROM appointments 
        WHERE status = 'confirmed'
        AND start_at < ? AND end_at > ?
        ${staffId ? 'AND (staff_id = ? OR staff_id IS NULL)' : ''}
    `).get(staffId ? [endAt, startAt, staffId] : [endAt, startAt]);

    if (conflict) {
        return { valid: false, error: 'この時間帯は既に予約されています' };
    }

    return { valid: true, error: null };
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
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function getDayName(dayOfWeek) {
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    return days[dayOfWeek];
}

module.exports = {
    getAvailableSlots,
    getAvailableDates,
    validateBooking,
    formatDate,
    formatTime,
    formatDateTime
};
