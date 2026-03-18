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
    // 文字列として来ても数値に変換して扱う
    const smtpPort = parseInt(settings.smtp_port || process.env.SMTP_PORT || '587', 10);

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
            replyTo: settings.smtp_user || process.env.SMTP_USER,
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
            replyTo: settings.smtp_user || process.env.SMTP_USER,
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
async function logEmail(db, appointmentId, recipientEmail, subject, body, status, errorMessage = null) {
    try {
        // PostgreSQL対応 (dbオブジェクトは server/db/db.js のモジュールそのもの)
        if (db && db.insert) {
            await db.insert(`
                INSERT INTO email_logs (appointment_id, recipient_email, subject, body, status, error_message, sent_at)
                VALUES ($1, $2, $3, $4, $5, $6, NOW())
            `, [appointmentId, recipientEmail, subject, body, status, errorMessage]);
        } else {
            console.warn('⚠️ DBモジュールが正しく渡されていないため、メールログを保存できませんでした');
        }
    } catch (error) {
        console.error('メールログ保存エラー:', error.message);
    }
}

/**
 * 日本語形式の日付フォーマット（JST固定）
 */
function formatJapaneseDate(date) {
    // サーバーがUTCで動作するため、JST(UTC+9)に変換して表示
    const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    const year = jst.getUTCFullYear();
    const month = jst.getUTCMonth() + 1;
    const day = jst.getUTCDate();
    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
    const dayOfWeek = dayNames[jst.getUTCDay()];
    return `${year}年${month}月${day}日（${dayOfWeek}）`;
}

/**
 * 日本語形式の時刻フォーマット（JST固定）
 */
function formatJapaneseTime(date) {
    // サーバーがUTCで動作するため、JST(UTC+9)に変換して表示
    const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    const hours = jst.getUTCHours().toString().padStart(2, '0');
    const minutes = jst.getUTCMinutes().toString().padStart(2, '0');
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

    // カンマ区切りを配列に変換して整形（adminEmailがある場合のみ）
    const toAddress = adminEmail ? adminEmail.split(',').map(e => e.trim()).filter(e => e) : [];

    if (toAddress.length === 0) {
        console.log('📧 有効な管理者通知メールアドレスがないためスキップします');
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

${appointment.notes ? `━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ お困りごと・ご要望
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${appointment.notes}

` : ''}━━━━━━━━━━━━━━━━━━━━━━━━━━━━

管理画面で詳細をご確認ください。
${process.env.BASE_URL || 'http://localhost:3000'}/manage.html

※このメールは自動送信されています。
`.trim();

    // 各宛先に個別に送信（エラーの巻き添え防止）
    const results = [];

    for (const recipient of toAddress) {
        try {
            await transporter.sendMail({
                from: `"${clinicName} 予約システム" <${settings.smtp_user || process.env.SMTP_USER}>`,
                to: recipient,
                replyTo: settings.smtp_user || process.env.SMTP_USER,
                subject: subject,
                text: body
            });

            logEmail(db, appointment.id, recipient, subject, body, 'sent');
            console.log(`📧 管理者通知メールを送信しました: ${recipient}`);
            results.push({ email: recipient, success: true });

        } catch (error) {
            console.error(`📧 管理者通知メール送信エラー (${recipient}):`, error.message);
            logEmail(db, appointment.id, recipient, subject, body, 'failed', error.message);
            results.push({ email: recipient, success: false, error: error.message });
        }
    }

    // 全て失敗した場合のみエラー扱いとする（1つでも成功すれば成功とみなす）
    const allFailed = results.length > 0 && results.every(r => !r.success);
    if (results.length > 0 && allFailed) {
        return { success: false, error: results[0].error };
    }

    return { success: true };
}

module.exports = {
    sendConfirmationEmail,
    sendCancellationEmail,
    sendAdminNotificationEmail,
    createTransporter
};
