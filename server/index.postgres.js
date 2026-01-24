/**
 * 歯科医院予約システム - Express サーバー (PostgreSQL版)
 * Vercel Serverless対応
 */

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const cookieSession = require('cookie-session');
const path = require('path');

// ライブラリ
const security = require('./lib/security');
const slots = require('./lib/slots.postgres');
const mailer = require('./lib/mailer');
const db = require('./db/db');

// 設定
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-in-production';

// Express アプリ作成
const app = express();

// Vercelなどのプロキシ環境下でsecure Cookieを有効にするために必要
app.set('trust proxy', 1);

// リクエストログ
app.use((req, res, next) => {
    console.log(`[REQUEST] ${req.method} ${req.url}`);
    next();
});

// ===== ミドルウェア =====

// セキュリティヘッダー
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:"],
        }
    }
}));

// CORS
app.use(cors({
    origin: NODE_ENV === 'production' ? process.env.BASE_URL : true,
    credentials: true
}));

// JSONパーサー
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cookie-based セッション（サーバーレス対応）
app.use(cookieSession({
    name: 'session',
    keys: [SESSION_SECRET],
    maxAge: 24 * 60 * 60 * 1000, // 24時間
    secure: NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax'
}));

// レート制限（予約API用）
const bookingLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15分
    max: 10, // 10リクエストまで
    message: { error: 'リクエストが多すぎます。しばらく待ってから再度お試しください。' }
});

// 静的ファイル
app.use(express.static(path.join(__dirname, '..', 'client')));

// ===== ヘルパー関数 =====

async function getSettings() {
    const rows = await db.queryAll('SELECT key, value FROM settings');
    const settings = {};
    for (const row of rows) {
        settings[row.key] = row.value;
    }
    return settings;
}

function requireAdmin(req, res, next) {
    if (!req.session.adminId) {
        return res.status(401).json({ error: '認証が必要です' });
    }
    next();
}

async function logAudit(adminId, action, entityType, entityId, oldValue, newValue, req) {
    try {
        await db.execute(`
            INSERT INTO audit_logs (admin_id, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
            adminId,
            action,
            entityType,
            entityId,
            oldValue ? JSON.stringify(oldValue) : null,
            newValue ? JSON.stringify(newValue) : null,
            req.ip,
            req.get('User-Agent')
        ]);
    } catch (error) {
        console.error('監査ログエラー:', error.message);
    }
}

// ===== 公開API =====

// サービス一覧
app.get('/api/services', async (req, res) => {
    try {
        const services = await db.queryAll(`
            SELECT id, name, description, duration_minutes as duration
            FROM services WHERE is_active = true ORDER BY sort_order
        `);
        res.json(services);
    } catch (error) {
        console.error('サービス取得エラー:', error);
        res.status(500).json({ error: 'サービスの取得に失敗しました' });
    }
});

// スタッフ一覧
app.get('/api/staff', async (req, res) => {
    try {
        const staff = await db.queryAll(`
            SELECT id, name, title
            FROM staff WHERE is_active = true ORDER BY sort_order
        `);
        res.json(staff);
    } catch (error) {
        console.error('スタッフ取得エラー:', error);
        res.status(500).json({ error: 'スタッフの取得に失敗しました' });
    }
});

// 予約可能日一覧
app.get('/api/available-dates', async (req, res) => {
    try {
        const settings = await getSettings();
        const dates = await slots.getAvailableDates(settings);
        res.json(dates);
    } catch (error) {
        console.error('予約可能日取得エラー:', error);
        res.status(500).json({ error: '予約可能日の取得に失敗しました' });
    }
});

// 空き時間スロット
app.get('/api/slots', async (req, res) => {
    try {
        const { date, serviceId, staffId } = req.query;

        if (!date || !serviceId) {
            return res.status(400).json({ error: '日付とメニューを指定してください' });
        }

        const settings = await getSettings();
        const result = await slots.getAvailableSlots(
            date,
            parseInt(serviceId),
            staffId ? parseInt(staffId) : null,
            settings
        );

        if (result.error) {
            return res.status(400).json({ error: result.error, slots: [] });
        }

        res.json({ slots: result.slots });
    } catch (error) {
        console.error('スロット取得エラー:', error);
        res.status(500).json({ error: '空き時間の取得に失敗しました' });
    }
});

// 予約作成
app.post('/api/appointments', bookingLimiter, async (req, res) => {
    try {
        const { serviceId, staffId, startAt, endAt, name, kana, phone, email, address } = req.body;

        // 入力バリデーション
        const validation = security.validateAppointmentData({
            serviceId,
            startAt,
            name: security.sanitize(name),
            kana: security.sanitize(kana),
            phone: security.sanitize(phone),
            email: security.sanitize(email)
        });

        if (!validation.valid) {
            return res.status(400).json({ error: validation.errors.join(', ') });
        }

        const settings = await getSettings();

        // 予約の有効性を検証
        const bookingValidation = await slots.validateBooking(
            startAt,
            endAt,
            parseInt(serviceId),
            staffId ? parseInt(staffId) : null,
            settings
        );

        if (!bookingValidation.valid) {
            return res.status(400).json({ error: bookingValidation.error });
        }

        // 既存患者の検索（電話またはメールで一致）
        let patient = null;
        const cleanPhone = phone.replace(/[-\s]/g, '');

        if (email) {
            patient = await db.queryOne(`
                SELECT * FROM patients WHERE phone = $1 OR email = $2
            `, [cleanPhone, email]);
        } else {
            patient = await db.queryOne(`
                SELECT * FROM patients WHERE phone = $1
            `, [cleanPhone]);
        }

        // 患者が存在しない場合は新規作成
        if (!patient) {
            const patientId = await db.insert(`
                INSERT INTO patients (name, kana, phone, email, address)
                VALUES ($1, $2, $3, $4, $5)
            `, [
                security.sanitize(name),
                security.sanitize(kana),
                cleanPhone,
                email ? security.sanitize(email) : null,
                address ? security.sanitize(address) : null
            ]);
            patient = { id: patientId };
        } else {
            // 既存患者の情報を更新
            await db.execute(`
                UPDATE patients SET name = $1, kana = $2, email = COALESCE($3, email), address = COALESCE($4, address), updated_at = NOW()
                WHERE id = $5
            `, [
                security.sanitize(name),
                security.sanitize(kana),
                email ? security.sanitize(email) : null,
                address ? security.sanitize(address) : null,
                patient.id
            ]);
        }

        // アクセストークン生成
        const accessToken = security.generateAccessToken();
        const tokenHash = security.hashToken(accessToken);
        const tokenExpiry = security.calculateTokenExpiry();

        // 予約作成
        const appointmentId = await db.insert(`
            INSERT INTO appointments (patient_id, service_id, staff_id, start_at, end_at, access_token_hash, token_expires_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
            patient.id,
            parseInt(serviceId),
            staffId ? parseInt(staffId) : null,
            startAt,
            endAt,
            tokenHash,
            tokenExpiry.toISOString()
        ]);

        // 予約情報を取得（メール送信用）
        const appointment = await db.queryOne('SELECT * FROM appointments WHERE id = $1', [appointmentId]);
        const service = await db.queryOne('SELECT * FROM services WHERE id = $1', [serviceId]);
        const staff = staffId ? await db.queryOne('SELECT * FROM staff WHERE id = $1', [staffId]) : null;
        const patientData = await db.queryOne('SELECT * FROM patients WHERE id = $1', [patient.id]);

        // 確認メール送信（非同期、失敗しても予約は確定）
        mailer.sendConfirmationEmail(null, appointment, patientData, service, staff, accessToken, settings)
            .catch(err => console.error('メール送信エラー:', err));

        // 管理者への通知メール送信（非同期）
        mailer.sendAdminNotificationEmail(null, appointment, patientData, service, staff, settings)
            .catch(err => console.error('管理者通知メール送信エラー:', err));

        res.status(201).json({
            success: true,
            appointmentId,
            message: '予約が完了しました',
            appointment: {
                id: appointmentId,
                startAt,
                endAt,
                service: service.name,
                staff: staff ? staff.name : '指名なし'
            }
        });

    } catch (error) {
        console.error('予約作成エラー:', error);
        res.status(500).json({ error: '予約の作成に失敗しました' });
    }
});

// トークンで予約取得
app.get('/api/appointments/by-token', async (req, res) => {
    try {
        const { token } = req.query;

        if (!token) {
            return res.status(400).json({ error: 'トークンが必要です' });
        }

        const tokenHash = security.hashToken(token);

        const appointment = await db.queryOne(`
            SELECT 
                a.*,
                s.name as service_name,
                st.name as staff_name,
                p.name as patient_name,
                p.phone as patient_phone
            FROM appointments a
            JOIN services s ON a.service_id = s.id
            LEFT JOIN staff st ON a.staff_id = st.id
            JOIN patients p ON a.patient_id = p.id
            WHERE a.access_token_hash = $1
            AND a.token_expires_at > NOW()
        `, [tokenHash]);

        if (!appointment) {
            return res.status(404).json({ error: '予約が見つからないか、リンクの有効期限が切れています' });
        }

        res.json({
            id: appointment.id,
            startAt: appointment.start_at,
            endAt: appointment.end_at,
            status: appointment.status,
            serviceName: appointment.service_name,
            staffName: appointment.staff_name || '指名なし',
            patientName: appointment.patient_name
        });

    } catch (error) {
        console.error('予約取得エラー:', error);
        res.status(500).json({ error: '予約の取得に失敗しました' });
    }
});

// 予約キャンセル
app.post('/api/appointments/cancel', bookingLimiter, async (req, res) => {
    try {
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({ error: 'トークンが必要です' });
        }

        const tokenHash = security.hashToken(token);

        const appointment = await db.queryOne(`
            SELECT a.*, p.*, s.name as service_name
            FROM appointments a
            JOIN patients p ON a.patient_id = p.id
            JOIN services s ON a.service_id = s.id
            WHERE a.access_token_hash = $1
            AND a.token_expires_at > NOW()
            AND a.status = 'confirmed'
        `, [tokenHash]);

        if (!appointment) {
            return res.status(404).json({ error: '予約が見つからないか、既にキャンセル済みです' });
        }

        // キャンセル締切チェック
        const settings = await getSettings();
        const cutoffDays = parseInt(settings.booking_cutoff_days) || 2;
        const startDate = new Date(appointment.start_at);
        const cutoffDate = new Date(startDate);
        cutoffDate.setDate(cutoffDate.getDate() - cutoffDays);

        if (new Date() > cutoffDate) {
            return res.status(400).json({
                error: `キャンセルは予約日の${cutoffDays}日前までです。お電話でお問い合わせください。`
            });
        }

        // キャンセル実行
        await db.execute(`
            UPDATE appointments SET status = 'cancelled', updated_at = NOW()
            WHERE id = $1
        `, [appointment.id]);

        // キャンセルメール送信
        const service = { name: appointment.service_name };
        const patient = { name: appointment.name, email: appointment.email };
        mailer.sendCancellationEmail(null, appointment, patient, service, settings)
            .catch(err => console.error('キャンセルメール送信エラー:', err));

        res.json({ success: true, message: '予約をキャンセルしました' });

    } catch (error) {
        console.error('キャンセルエラー:', error);
        res.status(500).json({ error: 'キャンセルに失敗しました' });
    }
});

// ===== 管理者API =====

// ログイン
app.post('/api/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'ユーザー名とパスワードを入力してください' });
        }

        const admin = await db.queryOne(`
            SELECT * FROM admins WHERE username = $1 AND is_active = true
        `, [username]);

        if (!admin) {
            return res.status(401).json({ error: 'ユーザー名またはパスワードが正しくありません' });
        }

        const validPassword = await security.verifyPassword(password, admin.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'ユーザー名またはパスワードが正しくありません' });
        }

        // ログイン成功
        req.session.adminId = admin.id;
        req.session.adminName = admin.display_name;

        // 最終ログイン更新
        await db.execute(`
            UPDATE admins SET last_login_at = NOW() WHERE id = $1
        `, [admin.id]);

        // 監査ログ
        await logAudit(admin.id, 'login', 'admin', admin.id, null, null, req);

        res.json({
            success: true,
            admin: {
                id: admin.id,
                username: admin.username,
                displayName: admin.display_name
            }
        });

    } catch (error) {
        console.error('ログインエラー:', error);
        res.status(500).json({ error: 'ログインに失敗しました' });
    }
});

// ログアウト
app.post('/api/admin/logout', async (req, res) => {
    if (req.session.adminId) {
        await logAudit(req.session.adminId, 'logout', 'admin', req.session.adminId, null, null, req);
    }
    req.session = null;
    res.json({ success: true });
});

// セッション確認
app.get('/api/admin/me', requireAdmin, (req, res) => {
    res.json({
        id: req.session.adminId,
        displayName: req.session.adminName
    });
});

// 予約一覧（管理者用）
app.get('/api/admin/appointments', requireAdmin, async (req, res) => {
    try {
        const { start, end, status } = req.query;

        let query = `
            SELECT 
                a.id, a.start_at, a.end_at, a.status, a.notes, a.created_at,
                s.name as service_name, s.duration_minutes,
                st.name as staff_name,
                p.id as patient_id, p.name as patient_name, p.kana as patient_kana, p.phone as patient_phone
            FROM appointments a
            JOIN services s ON a.service_id = s.id
            LEFT JOIN staff st ON a.staff_id = st.id
            JOIN patients p ON a.patient_id = p.id
            WHERE 1=1
        `;
        const params = [];
        let paramIndex = 1;

        if (start) {
            query += ` AND a.start_at >= $${paramIndex++}`;
            params.push(start);
        }
        if (end) {
            query += ` AND a.start_at <= $${paramIndex++}`;
            params.push(end);
        }
        if (status) {
            query += ` AND a.status = $${paramIndex++}`;
            params.push(status);
        }

        query += ' ORDER BY a.start_at ASC';

        const appointments = await db.queryAll(query, params);
        res.json(appointments);

    } catch (error) {
        console.error('予約一覧取得エラー:', error);
        res.status(500).json({ error: '予約一覧の取得に失敗しました' });
    }
});

// 予約削除 (管理者用)
app.delete('/api/admin/appointments/:id', requireAdmin, async (req, res) => {
    try {
        const id = req.params.id;

        // 削除対象の存在確認
        const apt = await db.queryOne('SELECT * FROM appointments WHERE id = $1', [id]);
        if (!apt) {
            return res.status(404).json({ error: '予約が見つかりません' });
        }

        await db.execute('DELETE FROM appointments WHERE id = $1', [id]);

        await logAudit(req.session.adminId, 'delete_appointment', 'appointment', id, apt, null, req);

        res.json({ success: true, message: '予約を削除しました' });

    } catch (error) {
        console.error('予約削除エラー:', error);
        res.status(500).json({ error: '予約の削除に失敗しました' });
    }
});

// 新規予約作成 (管理者・電話予約用)
app.post('/api/admin/appointments', requireAdmin, async (req, res) => {
    try {
        const { name, startAt, serviceId, notes } = req.body;

        if (!name || !startAt) {
            return res.status(400).json({ error: '名前と日時は必須です' });
        }

        const client = await db.getPool().connect();
        try {
            await client.query('BEGIN');

            // 1. 患者登録（電話番号・カナは空でOK）
            const patientRes = await client.query(`
                INSERT INTO patients (name, kana, phone, created_at, updated_at)
                VALUES ($1, $2, $3, NOW(), NOW())
                RETURNING id
            `, [name, '', '']);

            const patientId = patientRes.rows[0].id;

            // 2. 予約作成
            const serviceIdToUse = serviceId || 1;
            const serviceRes = await client.query('SELECT duration_minutes FROM services WHERE id = $1', [serviceIdToUse]);
            const duration = serviceRes.rows[0] ? serviceRes.rows[0].duration_minutes : 30;

            const startDate = new Date(startAt);
            const endDate = new Date(startDate.getTime() + duration * 60000);

            // 明示的にUTC文字列に変換してDBに渡す（勝手なタイムゾーン変換を防ぐ）
            const startParam = startDate.toISOString();
            const endParam = endDate.toISOString();

            // トークン生成
            const crypto = require('crypto');
            const accessToken = crypto.randomBytes(32).toString('hex');
            const tokenExpiresAt = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);

            const aptRes = await client.query(`
                INSERT INTO appointments (
                    patient_id, service_id, start_at, end_at, status, 
                    access_token_hash, token_expires_at, notes, created_at, updated_at
                )
                VALUES ($1, $2, $3, $4, 'confirmed', $5, $6, $7, NOW(), NOW())
                RETURNING id
            `, [
                patientId, serviceIdToUse, startParam, endParam,
                accessToken, tokenExpiresAt, notes || ''
            ]);

            const newAptId = aptRes.rows[0].id;

            await client.query('COMMIT');

            // ログ記録
            await logAudit(
                req.session.adminId, 'create_appointment_phone', 'appointment',
                newAptId, null, { name, startAt }, req
            );

            res.json({ success: true, message: '予約を作成しました' });

        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }

    } catch (error) {
        console.error('管理者予約作成エラー:', error);
        res.status(500).json({ error: '予約の作成に失敗しました: ' + error.message });
    }
});

// 予約詳細
app.get('/api/admin/appointments/:id', requireAdmin, async (req, res) => {
    try {
        const appointment = await db.queryOne(`
            SELECT 
                a.*,
                s.name as service_name, s.duration_minutes,
                st.name as staff_name,
                p.*
            FROM appointments a
            JOIN services s ON a.service_id = s.id
            LEFT JOIN staff st ON a.staff_id = st.id
            JOIN patients p ON a.patient_id = p.id
            WHERE a.id = $1
        `, [req.params.id]);

        if (!appointment) {
            return res.status(404).json({ error: '予約が見つかりません' });
        }

        res.json(appointment);

    } catch (error) {
        console.error('予約詳細取得エラー:', error);
        res.status(500).json({ error: '予約詳細の取得に失敗しました' });
    }
});

// 予約更新
app.put('/api/admin/appointments/:id', requireAdmin, async (req, res) => {
    try {
        const { status, notes } = req.body;
        const appointmentId = req.params.id;

        const oldAppointment = await db.queryOne('SELECT * FROM appointments WHERE id = $1', [appointmentId]);
        if (!oldAppointment) {
            return res.status(404).json({ error: '予約が見つかりません' });
        }

        if (status) {
            await db.execute(`
                UPDATE appointments SET status = $1, updated_at = NOW() WHERE id = $2
            `, [status, appointmentId]);
        }

        if (notes !== undefined) {
            await db.execute(`
                UPDATE appointments SET notes = $1, updated_at = NOW() WHERE id = $2
            `, [notes, appointmentId]);
        }

        const newAppointment = await db.queryOne('SELECT * FROM appointments WHERE id = $1', [appointmentId]);
        await logAudit(req.session.adminId, 'update_appointment', 'appointment', appointmentId, oldAppointment, newAppointment, req);

        res.json({ success: true });

    } catch (error) {
        console.error('予約更新エラー:', error);
        res.status(500).json({ error: '予約の更新に失敗しました' });
    }
});

// 予約削除
app.delete('/api/admin/appointments/:id', requireAdmin, async (req, res) => {
    try {
        const appointmentId = req.params.id;

        const appointment = await db.queryOne('SELECT * FROM appointments WHERE id = $1', [appointmentId]);
        if (!appointment) {
            return res.status(404).json({ error: '予約が見つかりません' });
        }

        await db.execute('DELETE FROM appointments WHERE id = $1', [appointmentId]);
        await logAudit(req.session.adminId, 'delete_appointment', 'appointment', appointmentId, appointment, null, req);

        res.json({ success: true });

    } catch (error) {
        console.error('予約削除エラー:', error);
        res.status(500).json({ error: '予約の削除に失敗しました' });
    }
});

// CSVエクスポート
app.get('/api/admin/appointments/export/csv', requireAdmin, async (req, res) => {
    try {
        const { start, end } = req.query;

        let query = `
            SELECT 
                a.id, a.start_at, a.end_at, a.status,
                s.name as service_name,
                st.name as staff_name,
                p.name as patient_name, p.kana as patient_kana, p.phone as patient_phone, p.email as patient_email
            FROM appointments a
            JOIN services s ON a.service_id = s.id
            LEFT JOIN staff st ON a.staff_id = st.id
            JOIN patients p ON a.patient_id = p.id
            WHERE 1=1
        `;
        const params = [];
        let paramIndex = 1;

        if (start) {
            query += ` AND a.start_at >= $${paramIndex++}`;
            params.push(start);
        }
        if (end) {
            query += ` AND a.start_at <= $${paramIndex++}`;
            params.push(end);
        }

        query += ' ORDER BY a.start_at ASC';

        const appointments = await db.queryAll(query, params);

        // CSV生成
        const headers = ['予約ID', '予約日時', '終了時刻', 'ステータス', 'メニュー', '担当', '患者名', 'ふりがな', '電話番号', 'メールアドレス'];
        let csv = '\uFEFF' + headers.join(',') + '\n'; // BOM付きUTF-8

        for (const apt of appointments) {
            const row = [
                apt.id,
                apt.start_at,
                apt.end_at,
                apt.status,
                apt.service_name,
                apt.staff_name || '',
                apt.patient_name,
                apt.patient_kana,
                apt.patient_phone,
                apt.patient_email || ''
            ].map(val => `"${String(val).replace(/"/g, '""')}"`);
            csv += row.join(',') + '\n';
        }

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="appointments_${new Date().toISOString().split('T')[0]}.csv"`);
        res.send(csv);

    } catch (error) {
        console.error('CSVエクスポートエラー:', error);
        res.status(500).json({ error: 'エクスポートに失敗しました' });
    }
});

// 患者一覧
app.get('/api/admin/patients', requireAdmin, async (req, res) => {
    try {
        const { search } = req.query;

        let query = `
            SELECT p.*, 
                (SELECT COUNT(*) FROM appointments WHERE patient_id = p.id) as appointment_count,
                (SELECT MAX(start_at) FROM appointments WHERE patient_id = p.id) as last_visit
            FROM patients p
            WHERE 1=1
        `;
        const params = [];

        if (search) {
            query += ` AND (p.name LIKE $1 OR p.kana LIKE $1 OR p.phone LIKE $1 OR p.email LIKE $1)`;
            params.push(`%${search}%`);
        }

        query += ' ORDER BY p.created_at DESC LIMIT 100';

        const patients = await db.queryAll(query, params);
        res.json(patients);

    } catch (error) {
        console.error('患者一覧取得エラー:', error);
        res.status(500).json({ error: '患者一覧の取得に失敗しました' });
    }
});

// 患者詳細
app.get('/api/admin/patients/:id', requireAdmin, async (req, res) => {
    try {
        const patient = await db.queryOne('SELECT * FROM patients WHERE id = $1', [req.params.id]);

        if (!patient) {
            return res.status(404).json({ error: '患者が見つかりません' });
        }

        // 予約履歴
        const appointments = await db.queryAll(`
            SELECT a.*, s.name as service_name, st.name as staff_name
            FROM appointments a
            JOIN services s ON a.service_id = s.id
            LEFT JOIN staff st ON a.staff_id = st.id
            WHERE a.patient_id = $1
            ORDER BY a.start_at DESC
        `, [req.params.id]);

        // メモ
        const notes = await db.queryAll(`
            SELECT n.*, a.display_name as created_by_name
            FROM patient_notes n
            LEFT JOIN admins a ON n.created_by = a.id
            WHERE n.patient_id = $1
            ORDER BY n.created_at DESC
        `, [req.params.id]);

        res.json({
            ...patient,
            appointments,
            notes
        });

    } catch (error) {
        console.error('患者詳細取得エラー:', error);
        res.status(500).json({ error: '患者詳細の取得に失敗しました' });
    }
});

// 患者メモ追加
app.post('/api/admin/patients/:id/notes', requireAdmin, async (req, res) => {
    try {
        const { note } = req.body;
        const patientId = req.params.id;

        if (!note || !note.trim()) {
            return res.status(400).json({ error: 'メモを入力してください' });
        }

        const patient = await db.queryOne('SELECT * FROM patients WHERE id = $1', [patientId]);
        if (!patient) {
            return res.status(404).json({ error: '患者が見つかりません' });
        }

        const noteId = await db.insert(`
            INSERT INTO patient_notes (patient_id, note, created_by)
            VALUES ($1, $2, $3)
        `, [patientId, security.sanitize(note), req.session.adminId]);

        await logAudit(req.session.adminId, 'add_patient_note', 'patient_note', noteId, null, { patientId, note }, req);

        res.status(201).json({ success: true, noteId });

    } catch (error) {
        console.error('メモ追加エラー:', error);
        res.status(500).json({ error: 'メモの追加に失敗しました' });
    }
});

// SMTP設定取得
app.get('/api/admin/settings/smtp', requireAdmin, async (req, res) => {
    try {
        const settings = await getSettings();
        res.json({
            smtpHost: settings.smtp_host || 'smtp.gmail.com',
            smtpPort: settings.smtp_port || '587',
            smtpUser: settings.smtp_user || '',
            smtpPass: settings.smtp_pass ? '********' : '', // パスワードは隠す
            adminNotificationEmail: settings.admin_notification_email || ''
        });
    } catch (error) {
        console.error('SMTP設定取得エラー:', error);
        res.status(500).json({ error: 'SMTP設定の取得に失敗しました' });
    }
});

// SMTP設定保存
app.put('/api/admin/settings/smtp', requireAdmin, async (req, res) => {
    try {
        const { smtpHost, smtpPort, smtpUser, smtpPass, adminNotificationEmail } = req.body;

        const upsertSetting = async (key, value) => {
            await db.execute(`
                INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
                ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
            `, [key, value]);
        };

        if (smtpHost) await upsertSetting('smtp_host', smtpHost);
        if (smtpPort) await upsertSetting('smtp_port', smtpPort);
        if (smtpUser) await upsertSetting('smtp_user', smtpUser);
        // パスワードは********でなければ更新
        if (smtpPass && smtpPass !== '********') await upsertSetting('smtp_pass', smtpPass);
        if (adminNotificationEmail !== undefined) await upsertSetting('admin_notification_email', adminNotificationEmail);

        await logAudit(req.session.adminId, 'update_smtp_settings', 'settings', null, null, { smtpHost, smtpPort, smtpUser }, req);

        res.json({ success: true, message: 'SMTP設定を保存しました' });

    } catch (error) {
        console.error('SMTP設定保存エラー:', error);
        res.status(500).json({ error: 'SMTP設定の保存に失敗しました' });
    }
});

// テストメール送信
app.post('/api/admin/settings/smtp/test', requireAdmin, async (req, res) => {
    try {
        const settings = await getSettings();
        const testEmail = req.body.email || settings.admin_notification_email || settings.smtp_user;

        if (!testEmail) {
            return res.status(400).json({ error: 'テスト送信先メールアドレスを指定してください' });
        }

        if (!settings.smtp_user || !settings.smtp_pass) {
            return res.status(400).json({ error: 'SMTP設定が完了していません。設定を保存してください。' });
        }

        const nodemailer = require('nodemailer');
        const smtpPort = parseInt(settings.smtp_port) || 587;
        const isSecure = smtpPort === 465;

        const transporter = nodemailer.createTransport({
            host: settings.smtp_host || 'smtp.gmail.com',
            port: smtpPort,
            secure: isSecure,
            auth: {
                user: settings.smtp_user,
                pass: settings.smtp_pass
            },
            tls: {
                rejectUnauthorized: false
            },
            connectionTimeout: 10000,
            greetingTimeout: 10000
        });

        await transporter.sendMail({
            from: `"彦歯科医院 予約システム" <${settings.smtp_user}>`,
            to: testEmail,
            subject: '【テスト】メール設定確認',
            text: `これは彦歯科医院予約システムからのテストメールです。\n\nこのメールが届いていれば、SMTP設定は正しく動作しています。`
        });

        res.json({ success: true, message: `テストメールを ${testEmail} に送信しました` });

    } catch (error) {
        console.error('テストメール送信エラー:', error);
        res.status(500).json({ error: `メール送信エラー: ${error.message}` });
    }
});

// ===== 予約枠キャパシティ管理API =====

// キャパシティ設定一覧取得
app.get('/api/admin/slot-capacities', requireAdmin, async (req, res) => {
    try {
        const capacities = await db.queryAll(`
            SELECT * FROM slot_capacities ORDER BY day_of_week, time_slot
        `);

        // デフォルト値も取得
        const defaultCapacity = await db.queryOne(`
            SELECT value FROM settings WHERE key = 'default_slot_capacity'
        `);

        res.json({
            capacities,
            defaultCapacity: parseInt(defaultCapacity?.value) || 1
        });
    } catch (error) {
        console.error('キャパシティ設定取得エラー:', error);
        res.status(500).json({ error: 'キャパシティ設定の取得に失敗しました' });
    }
});

// デフォルトキャパシティ更新
app.put('/api/admin/slot-capacities/default', requireAdmin, async (req, res) => {
    try {
        const { capacity } = req.body;

        if (!capacity || capacity < 1) {
            return res.status(400).json({ error: 'キャパシティは1以上の数値を指定してください' });
        }

        await db.execute(`
            INSERT INTO settings (key, value, description)
            VALUES ('default_slot_capacity', $1, '時間枠あたりのデフォルト予約上限数')
            ON CONFLICT (key) DO UPDATE SET value = $1
        `, [String(capacity)]);

        await logAudit(req.session.adminId, 'update_default_capacity', 'settings', null, null, { capacity }, req);

        res.json({ success: true, message: 'デフォルトキャパシティを更新しました' });

    } catch (error) {
        console.error('デフォルトキャパシティ更新エラー:', error);
        res.status(500).json({ error: 'デフォルトキャパシティの更新に失敗しました' });
    }
});

// 一括キャパシティ設定（曜日×時間帯マトリクス）
app.put('/api/admin/slot-capacities/bulk', requireAdmin, async (req, res) => {
    try {
        const { capacities } = req.body; // [{ dayOfWeek, timeSlot, capacity }, ...]

        if (!Array.isArray(capacities)) {
            return res.status(400).json({ error: '無効なデータ形式です' });
        }

        // トランザクションで一括処理
        await db.transaction(async (client) => {
            for (const item of capacities) {
                if (item.capacity === null || item.capacity === undefined) {
                    // 削除（デフォルトに戻す）
                    await client.query(`
                        DELETE FROM slot_capacities 
                        WHERE day_of_week = $1 AND time_slot = $2
                    `, [item.dayOfWeek, item.timeSlot]);
                } else {
                    // 追加/更新
                    await client.query(`
                        INSERT INTO slot_capacities (day_of_week, time_slot, capacity, updated_at)
                        VALUES ($1, $2, $3, NOW())
                        ON CONFLICT (day_of_week, time_slot) 
                        DO UPDATE SET capacity = $3, updated_at = NOW()
                    `, [item.dayOfWeek, item.timeSlot, item.capacity]);
                }
            }
        });

        await logAudit(req.session.adminId, 'bulk_update_capacity', 'slot_capacities', null, null, { count: capacities.length }, req);

        res.json({ success: true, message: 'キャパシティ設定を一括更新しました' });

    } catch (error) {
        console.error('一括キャパシティ更新エラー:', error);
        res.status(500).json({ error: 'キャパシティ設定の一括更新に失敗しました' });
    }
});

// 個別キャパシティ設定
app.put('/api/admin/slot-capacities/:dayOfWeek/:timeSlot', requireAdmin, async (req, res) => {
    try {
        const { dayOfWeek, timeSlot } = req.params;
        const { capacity } = req.body;

        if (capacity === null || capacity === undefined) {
            // 削除（デフォルトに戻す）
            await db.execute(`
                DELETE FROM slot_capacities 
                WHERE day_of_week = $1 AND time_slot = $2
            `, [dayOfWeek, timeSlot]);
        } else {
            if (capacity < 1) {
                return res.status(400).json({ error: 'キャパシティは1以上を指定してください' });
            }
            await db.execute(`
                INSERT INTO slot_capacities (day_of_week, time_slot, capacity, updated_at)
                VALUES ($1, $2, $3, NOW())
                ON CONFLICT (day_of_week, time_slot) 
                DO UPDATE SET capacity = $3, updated_at = NOW()
            `, [dayOfWeek, timeSlot, capacity]);
        }

        await logAudit(req.session.adminId, 'update_slot_capacity', 'slot_capacities', null, null, { dayOfWeek, timeSlot, capacity }, req);

        res.json({ success: true, message: 'キャパシティを更新しました' });

    } catch (error) {
        console.error('個別キャパシティ更新エラー:', error);
        res.status(500).json({ error: 'キャパシティの更新に失敗しました' });
    }
});

// 特定日付のキャパシティ設定取得
app.get('/api/admin/slot-capacities/date/:date', requireAdmin, async (req, res) => {
    try {
        const { date } = req.params;
        const targetDate = new Date(date);
        const dayOfWeek = targetDate.getDay(); // 0-6

        // 1. デフォルト値
        const defaultCapacityRes = await db.queryOne(`SELECT value FROM settings WHERE key = 'default_slot_capacity'`);
        const defaultCapacity = parseInt(defaultCapacityRes?.value) || 1;

        // 2. 曜日設定
        const dayCapacities = await db.queryAll(`
            SELECT time_slot, capacity FROM slot_capacities 
            WHERE day_of_week = $1 AND specific_date IS NULL
        `, [dayOfWeek]);

        // 3. 特定日設定
        const dateCapacities = await db.queryAll(`
            SELECT time_slot, capacity FROM slot_capacities 
            WHERE specific_date = $1
        `, [date]);

        // マージロジック
        // 全時間枠（9:00-19:00, 30分刻み）を生成して、優先順位に従って埋める
        const result = [];
        const startHour = 9;
        const endHour = 19;

        for (let h = startHour; h < endHour; h++) {
            for (let m of [0, 30]) {
                const timeSlot = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
                const displayTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

                let capacity = defaultCapacity;
                let source = 'default';

                const dayConfig = dayCapacities.find(c => c.time_slot === timeSlot);
                if (dayConfig) {
                    capacity = dayConfig.capacity;
                    source = 'day';
                }

                const dateConfig = dateCapacities.find(c => c.time_slot === timeSlot);
                if (dateConfig) {
                    capacity = dateConfig.capacity;
                    source = 'date';
                }

                result.push({
                    timeSlot: displayTime,
                    capacity,
                    source // default, day, date
                });
            }
        }

        res.json({ date, dayOfWeek, capacities: result });

    } catch (error) {
        console.error('特定日キャパシティ取得エラー:', error);
        res.status(500).json({ error: 'キャパシティ設定の取得に失敗しました' });
    }
});

// 特定日付のキャパシティ設定保存
app.put('/api/admin/slot-capacities/date/:date', requireAdmin, async (req, res) => {
    try {
        const { date } = req.params;
        const { capacities } = req.body; // [{ timeSlot: '09:00', capacity: 3 }, ...]

        if (!Array.isArray(capacities)) {
            return res.status(400).json({ error: '無効なデータ形式です' });
        }

        await db.transaction(async (client) => {
            for (const item of capacities) {
                // capacityがnull/undefined、または "default" "day" などの指示があれば削除
                // ここでは単純に「送られてきた値」を特定日設定として保存する
                // もし「設定解除（曜日設定に戻す）」場合は null を送る想定

                if (item.capacity === null) {
                    // 特定日設定削除
                    await client.query(`
                        DELETE FROM slot_capacities 
                        WHERE specific_date = $1 AND time_slot = $2
                    `, [date, item.timeSlot]);
                } else {
                    // 特定日設定追加/更新
                    await client.query(`
                        INSERT INTO slot_capacities (specific_date, time_slot, capacity, updated_at)
                        VALUES ($1, $2, $3, NOW())
                        ON CONFLICT (specific_date, time_slot) 
                        DO UPDATE SET capacity = $3, updated_at = NOW()
                    `, [date, item.timeSlot, item.capacity]);
                }
            }
        });

        await logAudit(req.session.adminId, 'update_date_capacity', 'slot_capacities', null, null, { date, count: capacities.length }, req);

        res.json({ success: true, message: `${date} のキャパシティ設定を保存しました` });

    } catch (error) {
        console.error('特定日キャパシティ保存エラー:', error);
        res.status(500).json({ error: 'キャパシティ設定の保存に失敗しました' });
    }
});

// ===== 医師（スタッフ）管理API =====

// スタッフ一覧（管理者用）
app.get('/api/admin/staff', requireAdmin, async (req, res) => {
    try {
        const staff = await db.queryAll(`
            SELECT * FROM staff WHERE is_active = true ORDER BY sort_order, id
        `);
        res.json(staff);
    } catch (error) {
        console.error('スタッフ取得エラー:', error);
        res.status(500).json({ error: 'スタッフの取得に失敗しました' });
    }
});

// スタッフ追加
app.post('/api/admin/staff', requireAdmin, async (req, res) => {
    try {
        const { name, title } = req.body;

        if (!name) {
            return res.status(400).json({ error: '名前を入力してください' });
        }

        const staffId = await db.insert(`
            INSERT INTO staff (name, title) VALUES ($1, $2)
        `, [name, title || null]);

        await logAudit(req.session.adminId, 'create_staff', 'staff', staffId, null, { name, title }, req);

        res.status(201).json({ success: true, message: 'スタッフを登録しました', id: staffId });

    } catch (error) {
        console.error('スタッフ登録エラー:', error);
        res.status(500).json({ error: 'スタッフの登録に失敗しました' });
    }
});

// スタッフ削除（論理削除）
app.delete('/api/admin/staff/:id', requireAdmin, async (req, res) => {
    try {
        const staffId = req.params.id;

        const staff = await db.queryOne('SELECT * FROM staff WHERE id = $1', [staffId]);
        if (!staff) {
            return res.status(404).json({ error: 'スタッフが見つかりません' });
        }

        console.log(`[DEBUG] Deleting staff ${staffId}`);
        const result = await db.execute("UPDATE staff SET is_active = false, updated_at = NOW() WHERE id = $1", [staffId]);
        console.log(`[DEBUG] Deleted staff ${staffId}, changes: ${result.rowCount}`);

        await logAudit(req.session.adminId, 'delete_staff', 'staff', staffId, staff, null, req);

        res.json({ success: true, message: 'スタッフを削除しました' });

    } catch (error) {
        console.error('スタッフ削除エラー:', error);
        res.status(500).json({ error: 'スタッフの削除に失敗しました' });
    }
});

// スタッフ並び替え
app.put('/api/admin/staff/reorder', requireAdmin, async (req, res) => {
    try {
        const { ids } = req.body; // IDの配列 (順序通り)

        if (!Array.isArray(ids)) {
            return res.status(400).json({ error: 'データ形式が正しくありません' });
        }

        await db.transaction(async (client) => {
            for (let i = 0; i < ids.length; i++) {
                await client.query("UPDATE staff SET sort_order = $1, updated_at = NOW() WHERE id = $2", [i, ids[i]]);
            }
        });

        res.json({ success: true, message: '順序を保存しました' });

    } catch (error) {
        console.error('並び替えエラー:', error);
        res.status(500).json({ error: '並び替えの保存に失敗しました' });
    }
});

// ===== 管理者アカウント管理API =====

// 管理者一覧
app.get('/api/admin/accounts', requireAdmin, async (req, res) => {
    try {
        const admins = await db.queryAll(`
            SELECT id, username, display_name, is_active, last_login_at, created_at 
            FROM admins ORDER BY id ASC
        `);
        res.json(admins);
    } catch (error) {
        console.error('管理者一覧取得エラー:', error);
        res.status(500).json({ error: '管理者一覧の取得に失敗しました' });
    }
});

// 管理者追加
app.post('/api/admin/accounts', requireAdmin, async (req, res) => {
    try {
        const { username, password, displayName } = req.body;

        if (!username || !password || !displayName) {
            return res.status(400).json({ error: '全ての項目を入力してください' });
        }

        // 既に使用されているユーザー名かチェック
        const existing = await db.queryOne('SELECT id FROM admins WHERE username = $1', [username]);
        if (existing) {
            return res.status(400).json({ error: 'このユーザー名は既に使用されています' });
        }

        const hashedPassword = await security.hashPassword(password);
        const adminId = await db.insert(`
            INSERT INTO admins (username, password_hash, display_name) VALUES ($1, $2, $3)
        `, [username, hashedPassword, displayName]);

        await logAudit(req.session.adminId, 'create_admin', 'admin', adminId, null, { username, displayName }, req);

        res.status(201).json({ success: true, message: '管理者を登録しました' });
    } catch (error) {
        console.error('管理者登録エラー:', error);
        res.status(500).json({ error: '管理者の登録に失敗しました' });
    }
});

// 管理者削除
app.delete('/api/admin/accounts/:id', requireAdmin, async (req, res) => {
    try {
        const targetId = parseInt(req.params.id);

        // 自分自身は削除不可
        if (targetId === req.session.adminId) {
            return res.status(400).json({ error: '自分自身のアカウントは削除できません' });
        }

        // 最後の1人は削除不可
        const result = await db.queryOne('SELECT COUNT(*) as total FROM admins');
        const count = parseInt(result.total);
        if (count <= 1) {
            return res.status(400).json({ error: '最後の管理者は削除できません' });
        }

        const admin = await db.queryOne('SELECT * FROM admins WHERE id = $1', [targetId]);
        if (!admin) {
            return res.status(404).json({ error: '管理者が見つかりません' });
        }

        await db.execute('DELETE FROM admins WHERE id = $1', [targetId]);
        await logAudit(req.session.adminId, 'delete_admin', 'admin', targetId, admin, null, req);

        res.json({ success: true, message: '管理者を削除しました' });
    } catch (error) {
        console.error('管理者削除エラー:', error);
        res.status(500).json({ error: '管理者の削除に失敗しました' });
    }
});

// ===== 営業時間管理API =====

// 営業時間一覧取得
app.get('/api/admin/business-hours', requireAdmin, async (req, res) => {
    try {
        const hours = await db.queryAll(`
            SELECT * FROM business_hours ORDER BY day_of_week
        `);
        res.json(hours);
    } catch (error) {
        console.error('営業時間取得エラー:', error);
        res.status(500).json({ error: '営業時間の取得に失敗しました' });
    }
});

// 営業時間更新
app.put('/api/admin/business-hours/:dayOfWeek', requireAdmin, async (req, res) => {
    try {
        const dayOfWeek = parseInt(req.params.dayOfWeek);
        const { isClosed, morningOpen, morningClose, afternoonOpen, afternoonClose } = req.body;

        if (dayOfWeek < 0 || dayOfWeek > 6) {
            return res.status(400).json({ error: '無効な曜日です' });
        }

        const oldHours = await db.queryOne('SELECT * FROM business_hours WHERE day_of_week = $1', [dayOfWeek]);

        if (isClosed) {
            await db.execute(`
                UPDATE business_hours 
                SET is_closed = true, morning_open = NULL, morning_close = NULL, 
                    afternoon_open = NULL, afternoon_close = NULL
                WHERE day_of_week = $1
            `, [dayOfWeek]);
        } else {
            await db.execute(`
                UPDATE business_hours 
                SET is_closed = false, 
                    morning_open = $1, morning_close = $2,
                    afternoon_open = $3, afternoon_close = $4
                WHERE day_of_week = $5
            `, [
                morningOpen || null, morningClose || null,
                afternoonOpen || null, afternoonClose || null,
                dayOfWeek
            ]);
        }

        const newHours = await db.queryOne('SELECT * FROM business_hours WHERE day_of_week = $1', [dayOfWeek]);
        await logAudit(req.session.adminId, 'update_business_hours', 'business_hours', dayOfWeek, oldHours, newHours, req);

        res.json({ success: true, message: '営業時間を更新しました' });
    } catch (error) {
        console.error('営業時間更新エラー:', error);
        res.status(500).json({ error: '営業時間の更新に失敗しました' });
    }
});

// 予約設定取得
app.get('/api/admin/settings/booking', requireAdmin, async (req, res) => {
    try {
        const settings = await getSettings();
        res.json({
            cutoffDays: parseInt(settings.booking_cutoff_days) || 2,
            cutoffHours: parseInt(settings.booking_cutoff_hours) || 3,
            maxDaysAhead: parseInt(settings.booking_max_days_ahead) || 60
        });
    } catch (error) {
        console.error('予約設定取得エラー:', error);
        res.status(500).json({ error: '予約設定の取得に失敗しました' });
    }
});

// 予約設定保存
app.put('/api/admin/settings/booking', requireAdmin, async (req, res) => {
    try {
        const { cutoffDays, cutoffHours, maxDaysAhead } = req.body;

        const upsertSetting = async (key, value) => {
            await db.execute(`
                INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
                ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
            `, [key, String(value)]);
        };

        if (cutoffDays !== undefined) await upsertSetting('booking_cutoff_days', cutoffDays);
        if (cutoffHours !== undefined) await upsertSetting('booking_cutoff_hours', cutoffHours);
        if (maxDaysAhead !== undefined) await upsertSetting('booking_max_days_ahead', maxDaysAhead);

        await logAudit(req.session.adminId, 'update_booking_settings', 'settings', null, null, { cutoffDays, cutoffHours, maxDaysAhead }, req);

        res.json({ success: true, message: '予約設定を保存しました' });
    } catch (error) {
        console.error('予約設定保存エラー:', error);
        res.status(500).json({ error: '予約設定の保存に失敗しました' });
    }
});

// デバッグ: 予約データ全消去
app.delete('/api/admin/debug/appointments', requireAdmin, async (req, res) => {
    try {
        await db.execute('TRUNCATE TABLE appointments CASCADE');
        await logAudit(req.session.adminId, 'debug_clear_appointments', 'system', null, null, null, req);
        res.json({ success: true, message: '全予約データを削除しました' });
    } catch (error) {
        console.error('全予約削除エラー:', error);
        res.status(500).json({ error: '削除に失敗しました: ' + error.message });
    }
});

// デバッグ: 患者データ全消去
app.delete('/api/admin/debug/patients', requireAdmin, async (req, res) => {
    try {
        // カスケード削除で関連する予約なども消える可能性がある旨はUIで警告済み
        await db.execute('TRUNCATE TABLE patients CASCADE');
        await logAudit(req.session.adminId, 'debug_clear_patients', 'system', null, null, null, req);
        res.json({ success: true, message: '全患者データを削除しました' });
    } catch (error) {
        console.error('全患者削除エラー:', error);
        res.status(500).json({ error: '削除に失敗しました: ' + error.message });
    }
});

// ===== スケジュール例外管理API =====

// スケジュール例外一覧取得
app.get('/api/admin/schedule-exceptions', requireAdmin, async (req, res) => {
    try {
        const { start, end, type } = req.query;

        let query = `
            SELECT se.*, a.display_name as created_by_name
            FROM schedule_exceptions se
            LEFT JOIN admins a ON se.created_by = a.id
            WHERE 1=1
        `;
        const params = [];
        let paramIndex = 1;

        if (start) {
            query += ` AND se.end_date >= $${paramIndex++}`;
            params.push(start);
        }
        if (end) {
            query += ` AND se.start_date <= $${paramIndex++}`;
            params.push(end);
        }
        if (type) {
            query += ` AND se.exception_type = $${paramIndex++}`;
            params.push(type);
        }

        query += ' ORDER BY se.start_date ASC, se.start_time ASC';

        const exceptions = await db.queryAll(query, params);
        res.json(exceptions);

    } catch (error) {
        console.error('スケジュール例外取得エラー:', error);
        res.status(500).json({ error: 'スケジュール例外の取得に失敗しました' });
    }
});

// スケジュール例外詳細取得
app.get('/api/admin/schedule-exceptions/:id', requireAdmin, async (req, res) => {
    try {
        const exception = await db.queryOne(`
            SELECT se.*, a.display_name as created_by_name
            FROM schedule_exceptions se
            LEFT JOIN admins a ON se.created_by = a.id
            WHERE se.id = $1
        `, [req.params.id]);

        if (!exception) {
            return res.status(404).json({ error: 'スケジュール例外が見つかりません' });
        }

        res.json(exception);

    } catch (error) {
        console.error('スケジュール例外詳細取得エラー:', error);
        res.status(500).json({ error: 'スケジュール例外の取得に失敗しました' });
    }
});

// スケジュール例外追加
app.post('/api/admin/schedule-exceptions', requireAdmin, async (req, res) => {
    try {
        const {
            exceptionType,
            startDate,
            endDate,
            startTime,
            endTime,
            morningOpen,
            morningClose,
            afternoonOpen,
            afternoonClose,
            reason,
            notes,
            isRecurring
        } = req.body;

        // バリデーション
        if (!startDate || !endDate) {
            return res.status(400).json({ error: '開始日と終了日は必須です' });
        }

        if (!exceptionType || !['closed', 'partial_closed', 'modified_hours', 'special_open'].includes(exceptionType)) {
            return res.status(400).json({ error: '無効な例外タイプです' });
        }

        // 日付の妥当性チェック
        if (new Date(startDate) > new Date(endDate)) {
            return res.status(400).json({ error: '終了日は開始日以降である必要があります' });
        }

        // 部分休業の場合は時間帯が必要
        if (exceptionType === 'partial_closed' && (!startTime || !endTime)) {
            return res.status(400).json({ error: '時間帯休業の場合は開始時間と終了時間が必要です' });
        }

        const exceptionId = await db.insert(`
            INSERT INTO schedule_exceptions (
                exception_type, start_date, end_date, 
                start_time, end_time,
                morning_open, morning_close, afternoon_open, afternoon_close,
                reason, notes, is_recurring, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        `, [
            exceptionType,
            startDate,
            endDate,
            startTime || null,
            endTime || null,
            morningOpen || null,
            morningClose || null,
            afternoonOpen || null,
            afternoonClose || null,
            reason || null,
            notes || null,
            isRecurring ? true : false,
            req.session.adminId
        ]);

        await logAudit(req.session.adminId, 'create_schedule_exception', 'schedule_exception', exceptionId, null, req.body, req);

        res.status(201).json({
            success: true,
            message: 'スケジュール例外を登録しました',
            id: exceptionId
        });

    } catch (error) {
        console.error('スケジュール例外登録エラー:', error);
        res.status(500).json({ error: 'スケジュール例外の登録に失敗しました' });
    }
});

// スケジュール例外更新
app.put('/api/admin/schedule-exceptions/:id', requireAdmin, async (req, res) => {
    try {
        const exceptionId = req.params.id;
        const {
            exceptionType,
            startDate,
            endDate,
            startTime,
            endTime,
            morningOpen,
            morningClose,
            afternoonOpen,
            afternoonClose,
            reason,
            notes,
            isRecurring
        } = req.body;

        const oldException = await db.queryOne('SELECT * FROM schedule_exceptions WHERE id = $1', [exceptionId]);
        if (!oldException) {
            return res.status(404).json({ error: 'スケジュール例外が見つかりません' });
        }

        // バリデーション
        if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
            return res.status(400).json({ error: '終了日は開始日以降である必要があります' });
        }

        await db.execute(`
            UPDATE schedule_exceptions SET
                exception_type = COALESCE($1, exception_type),
                start_date = COALESCE($2, start_date),
                end_date = COALESCE($3, end_date),
                start_time = $4,
                end_time = $5,
                morning_open = $6,
                morning_close = $7,
                afternoon_open = $8,
                afternoon_close = $9,
                reason = $10,
                notes = $11,
                is_recurring = COALESCE($12, is_recurring),
                updated_at = NOW()
            WHERE id = $13
        `, [
            exceptionType || null,
            startDate || null,
            endDate || null,
            startTime !== undefined ? (startTime || null) : oldException.start_time,
            endTime !== undefined ? (endTime || null) : oldException.end_time,
            morningOpen !== undefined ? (morningOpen || null) : oldException.morning_open,
            morningClose !== undefined ? (morningClose || null) : oldException.morning_close,
            afternoonOpen !== undefined ? (afternoonOpen || null) : oldException.afternoon_open,
            afternoonClose !== undefined ? (afternoonClose || null) : oldException.afternoon_close,
            reason !== undefined ? (reason || null) : oldException.reason,
            notes !== undefined ? (notes || null) : oldException.notes,
            isRecurring !== undefined ? (isRecurring ? true : false) : null,
            exceptionId
        ]);

        const newException = await db.queryOne('SELECT * FROM schedule_exceptions WHERE id = $1', [exceptionId]);
        await logAudit(req.session.adminId, 'update_schedule_exception', 'schedule_exception', exceptionId, oldException, newException, req);

        res.json({ success: true, message: 'スケジュール例外を更新しました' });

    } catch (error) {
        console.error('スケジュール例外更新エラー:', error);
        res.status(500).json({ error: 'スケジュール例外の更新に失敗しました' });
    }
});

// スケジュール例外削除
app.delete('/api/admin/schedule-exceptions/:id', requireAdmin, async (req, res) => {
    try {
        const exceptionId = req.params.id;

        const exception = await db.queryOne('SELECT * FROM schedule_exceptions WHERE id = $1', [exceptionId]);
        if (!exception) {
            return res.status(404).json({ error: 'スケジュール例外が見つかりません' });
        }

        await db.execute('DELETE FROM schedule_exceptions WHERE id = $1', [exceptionId]);
        await logAudit(req.session.adminId, 'delete_schedule_exception', 'schedule_exception', exceptionId, exception, null, req);

        res.json({ success: true, message: 'スケジュール例外を削除しました' });

    } catch (error) {
        console.error('スケジュール例外削除エラー:', error);
        res.status(500).json({ error: 'スケジュール例外の削除に失敗しました' });
    }
});

// 期間内の影響を受ける予約を取得
app.get('/api/admin/schedule-exceptions/affected-appointments', requireAdmin, async (req, res) => {
    try {
        const { startDate, endDate, startTime, endTime } = req.query;

        if (!startDate || !endDate) {
            return res.status(400).json({ error: '開始日と終了日を指定してください' });
        }

        let query = `
            SELECT 
                a.id, a.start_at, a.end_at, a.status,
                s.name as service_name,
                st.name as staff_name,
                p.name as patient_name, p.phone as patient_phone
            FROM appointments a
            JOIN services s ON a.service_id = s.id
            LEFT JOIN staff st ON a.staff_id = st.id
            JOIN patients p ON a.patient_id = p.id
            WHERE a.status = 'confirmed'
            AND DATE(a.start_at) >= $1 AND DATE(a.start_at) <= $2
        `;
        const params = [startDate, endDate];
        let paramIndex = 3;

        // 時間帯指定がある場合
        if (startTime && endTime) {
            query += ` AND (
                (CAST(a.start_at AS TIME) >= $${paramIndex} AND CAST(a.start_at AS TIME) < $${paramIndex + 1}) OR
                (CAST(a.end_at AS TIME) > $${paramIndex} AND CAST(a.end_at AS TIME) <= $${paramIndex + 1}) OR
                (CAST(a.start_at AS TIME) <= $${paramIndex} AND CAST(a.end_at AS TIME) >= $${paramIndex + 1})
            )`;
            params.push(startTime, endTime);
        }

        query += ' ORDER BY a.start_at ASC';

        const appointments = await db.queryAll(query, params);
        res.json(appointments);

    } catch (error) {
        console.error('影響予約取得エラー:', error);
        res.status(500).json({ error: '影響を受ける予約の取得に失敗しました' });
    }
});



// ===== Vercel Serverless Export =====
// Vercelの場合はサーバーを起動せず、appをエクスポート
if (process.env.VERCEL) {
    module.exports = app;
} else {
    // ローカル開発時はサーバーを起動
    app.listen(PORT, () => {
        console.log(`
🦷 歯科医院予約システムが起動しました (PostgreSQL版)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 URL: http://localhost:${PORT}
📍 管理画面: http://localhost:${PORT}/manage.html
🔧 環境: ${NODE_ENV}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        `);
    });

    // グレースフルシャットダウン
    process.on('SIGINT', async () => {
        console.log('\n🛑 サーバーを停止しています...');
        await db.closePool();
        process.exit(0);
    });
}
