/**
 * 歯科医院予約システム - Express サーバー
 */

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const path = require('path');
const Database = require('better-sqlite3');

// ライブラリ
const security = require('./lib/security');
const slots = require('./lib/slots');
const mailer = require('./lib/mailer');

// 設定
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-in-production';

// データベース接続
const DB_PATH = path.join(__dirname, 'db', 'clinic.db');
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

// Express アプリ作成
const app = express();

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

// セッション
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000 // 24時間
    }
}));

// レート制限（予約API用）
const bookingLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15分
    max: 10, // 10リクエストまで
    message: { error: 'リクエストが多すぎます。しばらく待ってから再度お試しください。' }
});

// レート制限（ログインAPI用 - ブルートフォース対策）
const loginLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5分
    max: 5, // 5回まで
    message: { error: 'ログイン試行が多すぎます。5分後に再度お試しください。' },
    standardHeaders: true,
    legacyHeaders: false
});

// 静的ファイル
app.use(express.static(path.join(__dirname, '..', 'client')));

// ===== ヘルパー関数 =====

function getSettings() {
    const rows = db.prepare('SELECT key, value FROM settings').all();
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

function logAudit(adminId, action, entityType, entityId, oldValue, newValue, req) {
    try {
        db.prepare(`
            INSERT INTO audit_logs (admin_id, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            adminId,
            action,
            entityType,
            entityId,
            oldValue ? JSON.stringify(oldValue) : null,
            newValue ? JSON.stringify(newValue) : null,
            req.ip,
            req.get('User-Agent')
        );
    } catch (error) {
        console.error('監査ログエラー:', error.message);
    }
}

// ===== 公開API =====

// サービス一覧
app.get('/api/services', (req, res) => {
    try {
        const services = db.prepare(`
            SELECT id, name, description, duration_minutes as duration
            FROM services WHERE is_active = 1 ORDER BY sort_order
        `).all();
        res.json(services);
    } catch (error) {
        console.error('サービス取得エラー:', error);
        res.status(500).json({ error: 'サービスの取得に失敗しました' });
    }
});

// スタッフ一覧
app.get('/api/staff', (req, res) => {
    try {
        const staff = db.prepare(`
            SELECT id, name, title
            FROM staff WHERE is_active = 1 ORDER BY sort_order
        `).all();
        res.json(staff);
    } catch (error) {
        console.error('スタッフ取得エラー:', error);
        res.status(500).json({ error: 'スタッフの取得に失敗しました' });
    }
});

// 予約可能日一覧
app.get('/api/available-dates', (req, res) => {
    try {
        const settings = getSettings();
        const dates = slots.getAvailableDates(db, settings);
        res.json(dates);
    } catch (error) {
        console.error('予約可能日取得エラー:', error);
        res.status(500).json({ error: '予約可能日の取得に失敗しました' });
    }
});

// 空き時間スロット
app.get('/api/slots', (req, res) => {
    try {
        const { date, serviceId, staffId } = req.query;

        if (!date || !serviceId) {
            return res.status(400).json({ error: '日付とメニューを指定してください' });
        }

        const settings = getSettings();
        const result = slots.getAvailableSlots(
            db,
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

        const settings = getSettings();

        // 予約の有効性を検証
        const bookingValidation = slots.validateBooking(
            db,
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
            patient = db.prepare(`
                SELECT * FROM patients WHERE phone = ? OR email = ?
            `).get(cleanPhone, email);
        } else {
            patient = db.prepare(`
                SELECT * FROM patients WHERE phone = ?
            `).get(cleanPhone);
        }

        // 患者が存在しない場合は新規作成
        if (!patient) {
            const insertPatient = db.prepare(`
                INSERT INTO patients (name, kana, phone, email, address)
                VALUES (?, ?, ?, ?, ?)
            `);
            const result = insertPatient.run(
                security.sanitize(name),
                security.sanitize(kana),
                cleanPhone,
                email ? security.sanitize(email) : null,
                address ? security.sanitize(address) : null
            );
            patient = { id: result.lastInsertRowid };
        } else {
            // 既存患者の情報を更新
            db.prepare(`
                UPDATE patients SET name = ?, kana = ?, email = COALESCE(?, email), address = COALESCE(?, address), updated_at = datetime('now', 'localtime')
                WHERE id = ?
            `).run(
                security.sanitize(name),
                security.sanitize(kana),
                email ? security.sanitize(email) : null,
                address ? security.sanitize(address) : null,
                patient.id
            );
        }

        // アクセストークン生成
        const accessToken = security.generateAccessToken();
        const tokenHash = security.hashToken(accessToken);
        const tokenExpiry = security.calculateTokenExpiry();

        // 予約作成
        const insertAppointment = db.prepare(`
            INSERT INTO appointments (patient_id, service_id, staff_id, start_at, end_at, access_token_hash, token_expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        const appointmentResult = insertAppointment.run(
            patient.id,
            parseInt(serviceId),
            staffId ? parseInt(staffId) : null,
            startAt,
            endAt,
            tokenHash,
            tokenExpiry.toISOString()
        );

        const appointmentId = appointmentResult.lastInsertRowid;

        // 予約情報を取得（メール送信用）
        const appointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(appointmentId);
        const service = db.prepare('SELECT * FROM services WHERE id = ?').get(serviceId);
        const staff = staffId ? db.prepare('SELECT * FROM staff WHERE id = ?').get(staffId) : null;
        const patientData = db.prepare('SELECT * FROM patients WHERE id = ?').get(patient.id);

        // 確認メール送信（非同期、失敗しても予約は確定）
        mailer.sendConfirmationEmail(db, appointment, patientData, service, staff, accessToken, settings)
            .catch(err => console.error('メール送信エラー:', err));

        // 管理者への通知メール送信（非同期）
        mailer.sendAdminNotificationEmail(db, appointment, patientData, service, staff, settings)
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
app.get('/api/appointments/by-token', (req, res) => {
    try {
        const { token } = req.query;

        if (!token) {
            return res.status(400).json({ error: 'トークンが必要です' });
        }

        const tokenHash = security.hashToken(token);

        const appointment = db.prepare(`
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
            WHERE a.access_token_hash = ?
            AND a.token_expires_at > datetime('now', 'localtime')
        `).get(tokenHash);

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

        const appointment = db.prepare(`
            SELECT a.*, p.*, s.name as service_name
            FROM appointments a
            JOIN patients p ON a.patient_id = p.id
            JOIN services s ON a.service_id = s.id
            WHERE a.access_token_hash = ?
            AND a.token_expires_at > datetime('now', 'localtime')
            AND a.status = 'confirmed'
        `).get(tokenHash);

        if (!appointment) {
            return res.status(404).json({ error: '予約が見つからないか、既にキャンセル済みです' });
        }

        // キャンセル締切チェック
        const settings = getSettings();
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
        db.prepare(`
            UPDATE appointments SET status = 'cancelled', updated_at = datetime('now', 'localtime')
            WHERE id = ?
        `).run(appointment.id);

        // キャンセルメール送信
        const service = { name: appointment.service_name };
        const patient = { name: appointment.name, email: appointment.email };
        mailer.sendCancellationEmail(db, appointment, patient, service, settings)
            .catch(err => console.error('キャンセルメール送信エラー:', err));

        res.json({ success: true, message: '予約をキャンセルしました' });

    } catch (error) {
        console.error('キャンセルエラー:', error);
        res.status(500).json({ error: 'キャンセルに失敗しました' });
    }
});

// ===== 管理者API =====

// ログイン
app.post('/api/admin/login', loginLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'ユーザー名とパスワードを入力してください' });
        }

        const admin = db.prepare(`
            SELECT * FROM admins WHERE username = ? AND is_active = 1
        `).get(username);

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
        db.prepare(`
            UPDATE admins SET last_login_at = datetime('now', 'localtime') WHERE id = ?
        `).run(admin.id);

        // 監査ログ
        logAudit(admin.id, 'login', 'admin', admin.id, null, null, req);

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
app.post('/api/admin/logout', (req, res) => {
    if (req.session.adminId) {
        logAudit(req.session.adminId, 'logout', 'admin', req.session.adminId, null, null, req);
    }
    req.session.destroy();
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
app.get('/api/admin/appointments', requireAdmin, (req, res) => {
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

        if (start) {
            query += ' AND a.start_at >= ?';
            params.push(start);
        }
        if (end) {
            query += ' AND a.start_at <= ?';
            params.push(end);
        }
        if (status) {
            query += ' AND a.status = ?';
            params.push(status);
        }

        query += ' ORDER BY a.start_at ASC';

        const appointments = db.prepare(query).all(...params);
        res.json(appointments);

    } catch (error) {
        console.error('予約一覧取得エラー:', error);
        res.status(500).json({ error: '予約一覧の取得に失敗しました' });
    }
});

// 予約詳細
app.get('/api/admin/appointments/:id', requireAdmin, (req, res) => {
    try {
        const appointment = db.prepare(`
            SELECT 
                a.*,
                s.name as service_name, s.duration_minutes,
                st.name as staff_name,
                p.*
            FROM appointments a
            JOIN services s ON a.service_id = s.id
            LEFT JOIN staff st ON a.staff_id = st.id
            JOIN patients p ON a.patient_id = p.id
            WHERE a.id = ?
        `).get(req.params.id);

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
app.put('/api/admin/appointments/:id', requireAdmin, (req, res) => {
    try {
        const { status, notes } = req.body;
        const appointmentId = req.params.id;

        const oldAppointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(appointmentId);
        if (!oldAppointment) {
            return res.status(404).json({ error: '予約が見つかりません' });
        }

        if (status) {
            db.prepare(`
                UPDATE appointments SET status = ?, updated_at = datetime('now', 'localtime') WHERE id = ?
            `).run(status, appointmentId);
        }

        if (notes !== undefined) {
            db.prepare(`
                UPDATE appointments SET notes = ?, updated_at = datetime('now', 'localtime') WHERE id = ?
            `).run(notes, appointmentId);
        }

        const newAppointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(appointmentId);
        logAudit(req.session.adminId, 'update_appointment', 'appointment', appointmentId, oldAppointment, newAppointment, req);

        res.json({ success: true });

    } catch (error) {
        console.error('予約更新エラー:', error);
        res.status(500).json({ error: '予約の更新に失敗しました' });
    }
});

// 予約削除
app.delete('/api/admin/appointments/:id', requireAdmin, (req, res) => {
    try {
        const appointmentId = req.params.id;

        const appointment = db.prepare('SELECT * FROM appointments WHERE id = ?').get(appointmentId);
        if (!appointment) {
            return res.status(404).json({ error: '予約が見つかりません' });
        }

        db.prepare('DELETE FROM appointments WHERE id = ?').run(appointmentId);
        logAudit(req.session.adminId, 'delete_appointment', 'appointment', appointmentId, appointment, null, req);

        res.json({ success: true });

    } catch (error) {
        console.error('予約削除エラー:', error);
        res.status(500).json({ error: '予約の削除に失敗しました' });
    }
});

// CSVエクスポート
app.get('/api/admin/appointments/export/csv', requireAdmin, (req, res) => {
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

        if (start) {
            query += ' AND a.start_at >= ?';
            params.push(start);
        }
        if (end) {
            query += ' AND a.start_at <= ?';
            params.push(end);
        }

        query += ' ORDER BY a.start_at ASC';

        const appointments = db.prepare(query).all(...params);

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
app.get('/api/admin/patients', requireAdmin, (req, res) => {
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
            query += ` AND (p.name LIKE ? OR p.kana LIKE ? OR p.phone LIKE ? OR p.email LIKE ?)`;
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm, searchTerm);
        }

        query += ' ORDER BY p.created_at DESC LIMIT 100';

        const patients = db.prepare(query).all(...params);
        res.json(patients);

    } catch (error) {
        console.error('患者一覧取得エラー:', error);
        res.status(500).json({ error: '患者一覧の取得に失敗しました' });
    }
});

// 患者詳細
app.get('/api/admin/patients/:id', requireAdmin, (req, res) => {
    try {
        const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(req.params.id);

        if (!patient) {
            return res.status(404).json({ error: '患者が見つかりません' });
        }

        // 予約履歴
        const appointments = db.prepare(`
            SELECT a.*, s.name as service_name, st.name as staff_name
            FROM appointments a
            JOIN services s ON a.service_id = s.id
            LEFT JOIN staff st ON a.staff_id = st.id
            WHERE a.patient_id = ?
            ORDER BY a.start_at DESC
        `).all(req.params.id);

        // メモ
        const notes = db.prepare(`
            SELECT n.*, a.display_name as created_by_name
            FROM patient_notes n
            LEFT JOIN admins a ON n.created_by = a.id
            WHERE n.patient_id = ?
            ORDER BY n.created_at DESC
        `).all(req.params.id);

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
app.post('/api/admin/patients/:id/notes', requireAdmin, (req, res) => {
    try {
        const { note } = req.body;
        const patientId = req.params.id;

        if (!note || !note.trim()) {
            return res.status(400).json({ error: 'メモを入力してください' });
        }

        const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId);
        if (!patient) {
            return res.status(404).json({ error: '患者が見つかりません' });
        }

        const result = db.prepare(`
            INSERT INTO patient_notes (patient_id, note, created_by)
            VALUES (?, ?, ?)
        `).run(patientId, security.sanitize(note), req.session.adminId);

        logAudit(req.session.adminId, 'add_patient_note', 'patient_note', result.lastInsertRowid, null, { patientId, note }, req);

        res.status(201).json({ success: true, noteId: result.lastInsertRowid });

    } catch (error) {
        console.error('メモ追加エラー:', error);
        res.status(500).json({ error: 'メモの追加に失敗しました' });
    }
});

// SMTP設定取得
app.get('/api/admin/settings/smtp', requireAdmin, (req, res) => {
    try {
        const settings = getSettings();
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
app.put('/api/admin/settings/smtp', requireAdmin, (req, res) => {
    try {
        const { smtpHost, smtpPort, smtpUser, smtpPass, adminNotificationEmail } = req.body;

        const upsert = db.prepare(`
            INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now', 'localtime'))
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `);

        if (smtpHost) upsert.run('smtp_host', smtpHost);
        if (smtpPort) upsert.run('smtp_port', smtpPort);
        if (smtpUser) upsert.run('smtp_user', smtpUser);
        // パスワードは********でなければ更新
        if (smtpPass && smtpPass !== '********') upsert.run('smtp_pass', smtpPass);
        if (adminNotificationEmail !== undefined) upsert.run('admin_notification_email', adminNotificationEmail);

        logAudit(req.session.adminId, 'update_smtp_settings', 'settings', null, null, { smtpHost, smtpPort, smtpUser }, req);

        res.json({ success: true, message: 'SMTP設定を保存しました' });

    } catch (error) {
        console.error('SMTP設定保存エラー:', error);
        res.status(500).json({ error: 'SMTP設定の保存に失敗しました' });
    }
});

// テストメール送信
app.post('/api/admin/settings/smtp/test', requireAdmin, async (req, res) => {
    try {
        const settings = getSettings();
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

// 予約設定取得
app.get('/api/admin/settings/booking', requireAdmin, (req, res) => {
    try {
        const settings = getSettings();
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
app.put('/api/admin/settings/booking', requireAdmin, (req, res) => {
    try {
        const { cutoffDays, cutoffHours, maxDaysAhead } = req.body;

        const upsertSetting = (key, value) => {
            db.prepare(`
                INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now', 'localtime'))
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now', 'localtime')
            `).run(key, String(value));
        };

        if (cutoffDays !== undefined) upsertSetting('booking_cutoff_days', cutoffDays);
        if (cutoffHours !== undefined) upsertSetting('booking_cutoff_hours', cutoffHours);
        if (maxDaysAhead !== undefined) upsertSetting('booking_max_days_ahead', maxDaysAhead);

        logAudit(req.session.adminId, 'update_booking_settings', 'settings', null, null, { cutoffDays, cutoffHours, maxDaysAhead }, req);

        res.json({ success: true, message: '予約設定を保存しました' });
    } catch (error) {
        console.error('予約設定保存エラー:', error);
        res.status(500).json({ error: '予約設定の保存に失敗しました' });
    }
});

// ===== 医師（スタッフ）管理API =====

// スタッフ一覧（管理者用）
app.get('/api/admin/staff', requireAdmin, (req, res) => {
    try {
        const staff = db.prepare(`
            SELECT * FROM staff WHERE is_active = 1 ORDER BY sort_order, id
        `).all();
        res.json(staff);
    } catch (error) {
        console.error('スタッフ取得エラー:', error);
        res.status(500).json({ error: 'スタッフの取得に失敗しました' });
    }
});

// スタッフ追加
app.post('/api/admin/staff', requireAdmin, (req, res) => {
    try {
        const { name, title } = req.body;

        if (!name) {
            return res.status(400).json({ error: '名前を入力してください' });
        }

        const result = db.prepare(`
            INSERT INTO staff (name, title) VALUES (?, ?)
        `).run(name, title || null);

        logAudit(req.session.adminId, 'create_staff', 'staff', result.lastInsertRowid, null, { name, title }, req);

        res.status(201).json({ success: true, message: 'スタッフを登録しました', id: result.lastInsertRowid });

    } catch (error) {
        console.error('スタッフ登録エラー:', error);
        res.status(500).json({ error: 'スタッフの登録に失敗しました' });
    }
});

// スタッフ削除（論理削除）
app.delete('/api/admin/staff/:id', requireAdmin, (req, res) => {
    try {
        const staffId = req.params.id;

        const staff = db.prepare('SELECT * FROM staff WHERE id = ?').get(staffId);
        if (!staff) {
            return res.status(404).json({ error: 'スタッフが見つかりません' });
        }

        console.log(`[DEBUG] Deleting staff ${staffId}`);
        const stmt = db.prepare("UPDATE staff SET is_active = 0, updated_at = datetime('now', 'localtime') WHERE id = ?");
        const info = stmt.run(staffId);
        console.log(`[DEBUG] Deleted staff ${staffId}, changes: ${info.changes}`);

        logAudit(req.session.adminId, 'delete_staff', 'staff', staffId, staff, null, req);

        res.json({ success: true, message: 'スタッフを削除しました' });

    } catch (error) {
        console.error('スタッフ削除エラー:', error);
        res.status(500).json({ error: 'スタッフの削除に失敗しました' });
    }
});

// スタッフ並び替え
app.put('/api/admin/staff/reorder', requireAdmin, (req, res) => {
    try {
        const { ids } = req.body; // IDの配列 (順序通り)

        if (!Array.isArray(ids)) {
            return res.status(400).json({ error: 'データ形式が正しくありません' });
        }

        const updateData = db.prepare("UPDATE staff SET sort_order = ?, updated_at = datetime('now', 'localtime') WHERE id = ?");

        const transaction = db.transaction((staffIds) => {
            for (let i = 0; i < staffIds.length; i++) {
                updateData.run(i, staffIds[i]);
            }
        });

        transaction(ids);

        res.json({ success: true, message: '順序を保存しました' });

    } catch (error) {
        console.error('並び替えエラー:', error);
    }
});

// ===== メニュー（サービス）管理API =====

// サービス一覧（管理者用・非アクティブ含む）
app.get('/api/admin/services', requireAdmin, (req, res) => {
    try {
        const services = db.prepare(`
            SELECT * FROM services ORDER BY sort_order, id
        `).all();
        res.json(services);
    } catch (error) {
        console.error('サービス取得エラー:', error);
        res.status(500).json({ error: 'サービスの取得に失敗しました' });
    }
});

// サービス追加
app.post('/api/admin/services', requireAdmin, (req, res) => {
    try {
        const { name, description, durationMinutes } = req.body;

        if (!name || !durationMinutes) {
            return res.status(400).json({ error: 'メニュー名と所要時間は必須です' });
        }

        const result = db.prepare(`
            INSERT INTO services (name, description, duration_minutes) VALUES (?, ?, ?)
        `).run(name, description || '', parseInt(durationMinutes));

        logAudit(req.session.adminId, 'create_service', 'service', result.lastInsertRowid, null, { name, description, durationMinutes }, req);

        res.status(201).json({ success: true, message: 'メニューを登録しました', id: result.lastInsertRowid });
    } catch (error) {
        console.error('サービス登録エラー:', error);
        res.status(500).json({ error: 'メニューの登録に失敗しました' });
    }
});

// サービス更新
app.put('/api/admin/services/:id', requireAdmin, (req, res) => {
    try {
        const serviceId = req.params.id;
        const { name, description, durationMinutes, isActive } = req.body;

        const oldService = db.prepare('SELECT * FROM services WHERE id = ?').get(serviceId);
        if (!oldService) {
            return res.status(404).json({ error: 'メニューが見つかりません' });
        }

        const updates = [];
        const params = [];

        if (name !== undefined) {
            updates.push('name = ?');
            params.push(name);
        }
        if (description !== undefined) {
            updates.push('description = ?');
            params.push(description);
        }
        if (durationMinutes !== undefined) {
            updates.push('duration_minutes = ?');
            params.push(parseInt(durationMinutes));
        }
        if (isActive !== undefined) {
            updates.push('is_active = ?');
            params.push(isActive ? 1 : 0);
        }

        if (updates.length > 0) {
            updates.push("updated_at = datetime('now', 'localtime')");
            params.push(serviceId);

            db.prepare(`UPDATE services SET ${updates.join(', ')} WHERE id = ?`).run(...params);
        }

        const newService = db.prepare('SELECT * FROM services WHERE id = ?').get(serviceId);
        logAudit(req.session.adminId, 'update_service', 'service', serviceId, oldService, newService, req);

        res.json({ success: true, message: 'メニューを更新しました' });
    } catch (error) {
        console.error('サービス更新エラー:', error);
        res.status(500).json({ error: 'メニューの更新に失敗しました' });
    }
});

// サービス削除（物理削除）
app.delete('/api/admin/services/:id', requireAdmin, (req, res) => {
    try {
        const serviceId = req.params.id;

        const service = db.prepare('SELECT * FROM services WHERE id = ?').get(serviceId);
        if (!service) {
            return res.status(404).json({ error: 'メニューが見つかりません' });
        }

        // このメニューに予約がある場合は削除不可
        const hasAppointments = db.prepare('SELECT COUNT(*) as count FROM appointments WHERE service_id = ?').get(serviceId);
        if (hasAppointments.count > 0) {
            return res.status(400).json({ error: 'このメニューには予約があるため削除できません。無効化のみ可能です。' });
        }

        db.prepare('DELETE FROM services WHERE id = ?').run(serviceId);
        logAudit(req.session.adminId, 'delete_service', 'service', serviceId, service, null, req);

        res.json({ success: true, message: 'メニューを削除しました' });
    } catch (error) {
        console.error('サービス削除エラー:', error);
        res.status(500).json({ error: 'メニューの削除に失敗しました' });
    }
});

// サービス並び替え
app.put('/api/admin/services/reorder', requireAdmin, (req, res) => {
    try {
        const { ids } = req.body;

        if (!Array.isArray(ids)) {
            return res.status(400).json({ error: 'データ形式が正しくありません' });
        }

        const updateData = db.prepare("UPDATE services SET sort_order = ?, updated_at = datetime('now', 'localtime') WHERE id = ?");

        const transaction = db.transaction((serviceIds) => {
            for (let i = 0; i < serviceIds.length; i++) {
                updateData.run(i, serviceIds[i]);
            }
        });

        transaction(ids);

        res.json({ success: true, message: '順序を保存しました' });
    } catch (error) {
        console.error('並び替えエラー:', error);
        res.status(500).json({ error: '並び替えの保存に失敗しました' });
    }
});

// ===== 営業時間管理API =====

// 営業時間一覧取得
app.get('/api/admin/business-hours', requireAdmin, (req, res) => {
    try {
        const hours = db.prepare(`
            SELECT * FROM business_hours ORDER BY day_of_week
        `).all();
        res.json(hours);
    } catch (error) {
        console.error('営業時間取得エラー:', error);
        res.status(500).json({ error: '営業時間の取得に失敗しました' });
    }
});

// 営業時間更新
app.put('/api/admin/business-hours/:dayOfWeek', requireAdmin, (req, res) => {
    try {
        const dayOfWeek = parseInt(req.params.dayOfWeek);
        const { isClosed, morningOpen, morningClose, afternoonOpen, afternoonClose } = req.body;

        if (dayOfWeek < 0 || dayOfWeek > 6) {
            return res.status(400).json({ error: '無効な曜日です' });
        }

        const oldHours = db.prepare('SELECT * FROM business_hours WHERE day_of_week = ?').get(dayOfWeek);

        if (isClosed) {
            db.prepare(`
                UPDATE business_hours 
                SET is_closed = 1, morning_open = NULL, morning_close = NULL, 
                    afternoon_open = NULL, afternoon_close = NULL
                WHERE day_of_week = ?
            `).run(dayOfWeek);
        } else {
            db.prepare(`
                UPDATE business_hours 
                SET is_closed = 0, 
                    morning_open = ?, morning_close = ?,
                    afternoon_open = ?, afternoon_close = ?
                WHERE day_of_week = ?
            `).run(
                morningOpen || null, morningClose || null,
                afternoonOpen || null, afternoonClose || null,
                dayOfWeek
            );
        }

        const newHours = db.prepare('SELECT * FROM business_hours WHERE day_of_week = ?').get(dayOfWeek);
        logAudit(req.session.adminId, 'update_business_hours', 'business_hours', dayOfWeek, oldHours, newHours, req);

        res.json({ success: true, message: '営業時間を更新しました' });
    } catch (error) {
        console.error('営業時間更新エラー:', error);
        res.status(500).json({ error: '営業時間の更新に失敗しました' });
    }
});

// ===== スケジュール例外管理API =====

// スケジュール例外一覧取得
app.get('/api/admin/schedule-exceptions', requireAdmin, (req, res) => {
    try {
        const { start, end, type } = req.query;

        let query = `
            SELECT se.*, a.display_name as created_by_name
            FROM schedule_exceptions se
            LEFT JOIN admins a ON se.created_by = a.id
            WHERE 1=1
        `;
        const params = [];

        if (start) {
            query += ' AND se.end_date >= ?';
            params.push(start);
        }
        if (end) {
            query += ' AND se.start_date <= ?';
            params.push(end);
        }
        if (type) {
            query += ' AND se.exception_type = ?';
            params.push(type);
        }

        query += ' ORDER BY se.start_date ASC, se.start_time ASC';

        const exceptions = db.prepare(query).all(...params);
        res.json(exceptions);

    } catch (error) {
        console.error('スケジュール例外取得エラー:', error);
        res.status(500).json({ error: 'スケジュール例外の取得に失敗しました' });
    }
});

// スケジュール例外詳細取得
app.get('/api/admin/schedule-exceptions/:id', requireAdmin, (req, res) => {
    try {
        const exception = db.prepare(`
            SELECT se.*, a.display_name as created_by_name
            FROM schedule_exceptions se
            LEFT JOIN admins a ON se.created_by = a.id
            WHERE se.id = ?
        `).get(req.params.id);

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
app.post('/api/admin/schedule-exceptions', requireAdmin, (req, res) => {
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

        const result = db.prepare(`
            INSERT INTO schedule_exceptions (
                exception_type, start_date, end_date, 
                start_time, end_time,
                morning_open, morning_close, afternoon_open, afternoon_close,
                reason, notes, is_recurring, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
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
            isRecurring ? 1 : 0,
            req.session.adminId
        );

        logAudit(req.session.adminId, 'create_schedule_exception', 'schedule_exception', result.lastInsertRowid, null, req.body, req);

        res.status(201).json({
            success: true,
            message: 'スケジュール例外を登録しました',
            id: result.lastInsertRowid
        });

    } catch (error) {
        console.error('スケジュール例外登録エラー:', error);
        res.status(500).json({ error: 'スケジュール例外の登録に失敗しました' });
    }
});

// スケジュール例外更新
app.put('/api/admin/schedule-exceptions/:id', requireAdmin, (req, res) => {
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

        const oldException = db.prepare('SELECT * FROM schedule_exceptions WHERE id = ?').get(exceptionId);
        if (!oldException) {
            return res.status(404).json({ error: 'スケジュール例外が見つかりません' });
        }

        // バリデーション
        if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
            return res.status(400).json({ error: '終了日は開始日以降である必要があります' });
        }

        db.prepare(`
            UPDATE schedule_exceptions SET
                exception_type = COALESCE(?, exception_type),
                start_date = COALESCE(?, start_date),
                end_date = COALESCE(?, end_date),
                start_time = ?,
                end_time = ?,
                morning_open = ?,
                morning_close = ?,
                afternoon_open = ?,
                afternoon_close = ?,
                reason = ?,
                notes = ?,
                is_recurring = COALESCE(?, is_recurring),
                updated_at = datetime('now', 'localtime')
            WHERE id = ?
        `).run(
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
            isRecurring !== undefined ? (isRecurring ? 1 : 0) : null,
            exceptionId
        );

        const newException = db.prepare('SELECT * FROM schedule_exceptions WHERE id = ?').get(exceptionId);
        logAudit(req.session.adminId, 'update_schedule_exception', 'schedule_exception', exceptionId, oldException, newException, req);

        res.json({ success: true, message: 'スケジュール例外を更新しました' });

    } catch (error) {
        console.error('スケジュール例外更新エラー:', error);
        res.status(500).json({ error: 'スケジュール例外の更新に失敗しました' });
    }
});

// スケジュール例外削除
app.delete('/api/admin/schedule-exceptions/:id', requireAdmin, (req, res) => {
    try {
        const exceptionId = req.params.id;

        const exception = db.prepare('SELECT * FROM schedule_exceptions WHERE id = ?').get(exceptionId);
        if (!exception) {
            return res.status(404).json({ error: 'スケジュール例外が見つかりません' });
        }

        db.prepare('DELETE FROM schedule_exceptions WHERE id = ?').run(exceptionId);
        logAudit(req.session.adminId, 'delete_schedule_exception', 'schedule_exception', exceptionId, exception, null, req);

        res.json({ success: true, message: 'スケジュール例外を削除しました' });

    } catch (error) {
        console.error('スケジュール例外削除エラー:', error);
        res.status(500).json({ error: 'スケジュール例外の削除に失敗しました' });
    }
});

// 期間内の影響を受ける予約を取得
app.get('/api/admin/schedule-exceptions/affected-appointments', requireAdmin, (req, res) => {
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
            AND DATE(a.start_at) >= ? AND DATE(a.start_at) <= ?
        `;
        const params = [startDate, endDate];

        // 時間帯指定がある場合
        if (startTime && endTime) {
            query += ` AND (
                (TIME(a.start_at) >= ? AND TIME(a.start_at) < ?) OR
                (TIME(a.end_at) > ? AND TIME(a.end_at) <= ?) OR
                (TIME(a.start_at) <= ? AND TIME(a.end_at) >= ?)
            )`;
            params.push(startTime, endTime, startTime, endTime, startTime, endTime);
        }

        query += ' ORDER BY a.start_at ASC';

        const appointments = db.prepare(query).all(...params);
        res.json(appointments);

    } catch (error) {
        console.error('影響予約取得エラー:', error);
        res.status(500).json({ error: '影響を受ける予約の取得に失敗しました' });
    }
});

// ===== 管理者アカウント管理API =====

// 管理者一覧
app.get('/api/admin/accounts', requireAdmin, (req, res) => {
    try {
        const admins = db.prepare(`
            SELECT id, username, display_name, is_active, last_login_at, created_at 
            FROM admins ORDER BY id ASC
        `).all();
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
        const existing = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
        if (existing) {
            return res.status(400).json({ error: 'このユーザー名は既に使用されています' });
        }

        const hashedPassword = await security.hashPassword(password);
        const result = db.prepare(`
            INSERT INTO admins (username, password_hash, display_name) VALUES (?, ?, ?)
        `).run(username, hashedPassword, displayName);

        logAudit(req.session.adminId, 'create_admin', 'admin', result.lastInsertRowid, null, { username, displayName }, req);

        res.status(201).json({ success: true, message: '管理者を登録しました' });
    } catch (error) {
        console.error('管理者登録エラー:', error);
        res.status(500).json({ error: '管理者の登録に失敗しました' });
    }
});

// 管理者削除
app.delete('/api/admin/accounts/:id', requireAdmin, (req, res) => {
    try {
        const targetId = parseInt(req.params.id);

        // 自分自身は削除不可
        if (targetId === req.session.adminId) {
            return res.status(400).json({ error: '自分自身のアカウントは削除できません' });
        }

        // 最後の1人は削除不可
        const count = db.prepare('SELECT COUNT(*) as total FROM admins').get().total;
        if (count <= 1) {
            return res.status(400).json({ error: '最後の管理者は削除できません' });
        }

        const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(targetId);
        if (!admin) {
            return res.status(404).json({ error: '管理者が見つかりません' });
        }

        db.prepare('DELETE FROM admins WHERE id = ?').run(targetId);
        logAudit(req.session.adminId, 'delete_admin', 'admin', targetId, admin, null, req);

        res.json({ success: true, message: '管理者を削除しました' });
    } catch (error) {
        console.error('管理者削除エラー:', error);
        res.status(500).json({ error: '管理者の削除に失敗しました' });
    }
});

// ===== サーバー起動 =====

app.listen(PORT, () => {
    console.log(`
🦷 歯科医院予約システムが起動しました
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 URL: http://localhost:${PORT}
📍 管理画面: http://localhost:${PORT}/manage.html
🔧 環境: ${NODE_ENV}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `);
});

// グレースフルシャットダウン
process.on('SIGINT', () => {
    console.log('\n🛑 サーバーを停止しています...');
    db.close();
    process.exit(0);
});
