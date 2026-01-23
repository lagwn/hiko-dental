/**
 * メール送信機能
 */

const nodemailer = require('nodemailer');

/**
 * メールトランスポーター作成
 * @param {Object} settings - システム設定（DBから取得）
 * @returns {Object} Nodemailer transporter
 */
function createTransporter(settings = {}) {
    // DB設定を優先、環境変数をフォールバック
    const smtpUser = settings.smtp_user || process.env.SMTP_USER;
    const smtpPass = settings.smtp_pass || process.env.SMTP_PASS;
    const smtpHost = settings.smtp_host || process.env.SMTP_HOST || 'smtp.gmail.com';
    const smtpPort = parseInt(settings.smtp_port || process.env.SMTP_PORT || '587');

    // ポート465はSSL、587はSTARTTLS
    const isSecure = smtpPort === 465;

    const config = {
        host: smtpHost,
        port: smtpPort,
        secure: isSecure,
        auth: {
            user: smtpUser,
            pass: smtpPass
        },
        tls: {
            rejectUnauthorized: false // 自己署名証明書を許可
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000
    };

    // SMTP設定がない場合はテストモード
    if (!config.auth.user || !config.auth.pass) {
        console.log('⚠️  SMTP設定がありません。メール送信はスキップされます。');
        return null;
    }

    return nodemailer.createTransport(config);
}

/**
 * 予約確認メールを送信
 * @param {Object} db - データベース接続
 * @param {Object} appointment - 予約情報
 * @param {Object} patient - 患者情報
 * @param {Object} service - サービス情報
 * @param {Object} staff - スタッフ情報（null可）
 * @param {string} accessToken - 平文アクセストークン
 * @param {Object} settings - システム設定
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function sendConfirmationEmail(db, appointment, patient, service, staff, accessToken, settings) {
    // メールアドレスがない場合はスキップ
    if (!patient.email) {
        console.log('📧 患者のメールアドレスがないため、メール送信をスキップします');
        return { success: true, skipped: true };
    }

    const transporter = createTransporter(settings);

    // トランスポーターがない場合（SMTP未設定）
    if (!transporter) {
        // ログには記録
        logEmail(db, appointment.id, patient.email, '【確認メール】', '(SMTP未設定のため送信スキップ)', 'skipped');
        return { success: true, skipped: true };
    }

    const clinicName = settings.clinic_name || '彦歯科医院';
    const clinicPhone = settings.clinic_phone || '';

    // 予約日時をフォーマット
    const startDate = new Date(appointment.start_at);
    const dateStr = formatJapaneseDate(startDate);
    const timeStr = formatJapaneseTime(startDate);

    // キャンセルURL生成
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const cancelUrl = `${baseUrl}/?token=${encodeURIComponent(accessToken)}`;

    const subject = `【${clinicName}】ご予約ありがとうございます（${dateStr} ${timeStr}）`;

    const body = `
${patient.name} 様

この度は${clinicName}をご予約いただき、誠にありがとうございます。
以下の内容でご予約を承りました。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ ご予約内容
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【予約日時】${dateStr} ${timeStr}
【メニュー】${service.name}
【担当】${staff ? staff.name : '指名なし'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ ご来院時のお願い
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

・保険証をお持ちください
・予約時間の5分前までにお越しください
・体調が優れない場合は事前にご連絡ください

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 予約の変更・キャンセル
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

下記URLより予約の確認・キャンセルが可能です。
${cancelUrl}

※キャンセルは予約日の2日前までにお願いいたします。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${clinicName}
${clinicPhone ? `電話: ${clinicPhone}` : ''}

※このメールは自動送信されています。
※ご不明な点がございましたら、お電話にてお問い合わせください。
`.trim();

    try {
        await transporter.sendMail({
            from: `"${clinicName}" <${settings.smtp_user || process.env.SMTP_USER}>`,
            to: patient.email,
            subject: subject,
            text: body
        });

        // 送信ログを保存
        logEmail(db, appointment.id, patient.email, subject, body, 'sent');
        console.log(`📧 確認メールを送信しました: ${patient.email}`);

        return { success: true };

    } catch (error) {
        console.error('📧 メール送信エラー:', error.message);

        // エラーログを保存
        logEmail(db, appointment.id, patient.email, subject, body, 'failed', error.message);

        // メール送信失敗でも予約は確定
        return { success: false, error: error.message };
    }
}

/**
 * キャンセル確認メールを送信
 * @param {Object} db - データベース接続
 * @param {Object} appointment - 予約情報
 * @param {Object} patient - 患者情報
 * @param {Object} service - サービス情報
 * @param {Object} settings - システム設定
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function sendCancellationEmail(db, appointment, patient, service, settings) {
    if (!patient.email) {
        return { success: true, skipped: true };
    }

    const transporter = createTransporter(settings);
    if (!transporter) {
        return { success: true, skipped: true };
    }

    const clinicName = settings.clinic_name || '彦歯科医院';
    const clinicPhone = settings.clinic_phone || '';

    const startDate = new Date(appointment.start_at);
    const dateStr = formatJapaneseDate(startDate);
    const timeStr = formatJapaneseTime(startDate);

    const subject = `【${clinicName}】ご予約キャンセルのお知らせ`;

    const body = `
${patient.name} 様

以下のご予約がキャンセルされました。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ キャンセルされた予約
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【予約日時】${dateStr} ${timeStr}
【メニュー】${service.name}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

再度のご予約をお待ちしております。

${clinicName}
${clinicPhone ? `電話: ${clinicPhone}` : ''}

※このメールは自動送信されています。
`.trim();

    try {
        await transporter.sendMail({
            from: `"${clinicName}" <${settings.smtp_user || process.env.SMTP_USER}>`,
            to: patient.email,
            subject: subject,
            text: body
        });

        logEmail(db, appointment.id, patient.email, subject, body, 'sent');
        return { success: true };

    } catch (error) {
        logEmail(db, appointment.id, patient.email, subject, body, 'failed', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * メール送信ログを保存
 */
function logEmail(db, appointmentId, recipientEmail, subject, body, status, errorMessage = null) {
    try {
        db.prepare(`
            INSERT INTO email_logs (appointment_id, recipient_email, subject, body, status, error_message, sent_at)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
        `).run(appointmentId, recipientEmail, subject, body, status, errorMessage);
    } catch (error) {
        console.error('メールログ保存エラー:', error.message);
    }
}

/**
 * 日本語形式の日付フォーマット
 */
function formatJapaneseDate(date) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
    const dayOfWeek = dayNames[date.getDay()];
    return `${year}年${month}月${day}日（${dayOfWeek}）`;
}

/**
 * 日本語形式の時刻フォーマット
 */
function formatJapaneseTime(date) {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
}

/**
 * 管理者への新規予約通知メールを送信
 * @param {Object} db - データベース接続
 * @param {Object} appointment - 予約情報
 * @param {Object} patient - 患者情報
 * @param {Object} service - サービス情報
 * @param {Object} staff - スタッフ情報（null可）
 * @param {Object} settings - システム設定
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function sendAdminNotificationEmail(db, appointment, patient, service, staff, settings) {
    // DB設定を優先、環境変数をフォールバック
    const adminEmail = settings.admin_notification_email || process.env.ADMIN_NOTIFICATION_EMAIL;

    // 管理者メールが設定されていない場合はスキップ
    if (!adminEmail) {
        console.log('📧 管理者通知メールアドレスが設定されていないため、通知をスキップします');
        return { success: true, skipped: true };
    }

    const transporter = createTransporter(settings);
    if (!transporter) {
        return { success: true, skipped: true };
    }

    const clinicName = settings.clinic_name || '彦歯科医院';

    // 予約日時をフォーマット
    const startDate = new Date(appointment.start_at);
    const dateStr = formatJapaneseDate(startDate);
    const timeStr = formatJapaneseTime(startDate);

    const subject = `【新規予約】${patient.name}様 ${dateStr} ${timeStr}`;

    const body = `
新規予約が入りました。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 予約内容
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【予約ID】#${appointment.id}
【予約日時】${dateStr} ${timeStr}
【メニュー】${service.name}
【担当】${staff ? staff.name : '指名なし'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 患者情報
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【氏名】${patient.name}（${patient.kana}）
【電話番号】${patient.phone}
【メール】${patient.email || '未登録'}
【住所】${patient.address || '未登録'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

管理画面で詳細をご確認ください。
${process.env.BASE_URL || 'http://localhost:3000'}/manage.html

※このメールは自動送信されています。
`.trim();

    try {
        await transporter.sendMail({
            from: `"${clinicName} 予約システム" <${settings.smtp_user || process.env.SMTP_USER}>`,
            to: adminEmail,
            subject: subject,
            text: body
        });

        logEmail(db, appointment.id, adminEmail, subject, body, 'sent');
        console.log(`📧 管理者通知メールを送信しました: ${adminEmail}`);

        return { success: true };

    } catch (error) {
        console.error('📧 管理者通知メール送信エラー:', error.message);
        logEmail(db, appointment.id, adminEmail, subject, body, 'failed', error.message);
        return { success: false, error: error.message };
    }
}

module.exports = {
    sendConfirmationEmail,
    sendCancellationEmail,
    sendAdminNotificationEmail,
    createTransporter
};
