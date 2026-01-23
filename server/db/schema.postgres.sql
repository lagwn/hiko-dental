-- 歯科医院予約システム データベーススキーマ
-- PostgreSQL 用

-- 管理者
CREATE TABLE IF NOT EXISTS admins (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 監査ログ
CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    admin_id INTEGER,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100),
    entity_id INTEGER,
    old_value JSONB,
    new_value JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_admin ON audit_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);

-- 診療メニュー
CREATE TABLE IF NOT EXISTS services (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    duration_minutes INTEGER NOT NULL DEFAULT 30,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- スタッフ
CREATE TABLE IF NOT EXISTS staff (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    title VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 患者
CREATE TABLE IF NOT EXISTS patients (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    kana VARCHAR(255) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(255),
    address TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 患者インデックス（検索用）
CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone);
CREATE INDEX IF NOT EXISTS idx_patients_email ON patients(email);
CREATE INDEX IF NOT EXISTS idx_patients_kana ON patients(kana);

-- 患者メモ（時系列カルテ）
CREATE TABLE IF NOT EXISTS patient_notes (
    id SERIAL PRIMARY KEY,
    patient_id INTEGER NOT NULL,
    note TEXT NOT NULL,
    created_by INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES admins(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_patient_notes_patient ON patient_notes(patient_id);

-- 予約
CREATE TABLE IF NOT EXISTS appointments (
    id SERIAL PRIMARY KEY,
    patient_id INTEGER NOT NULL,
    service_id INTEGER NOT NULL,
    staff_id INTEGER,
    start_at TIMESTAMP NOT NULL,
    end_at TIMESTAMP NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'confirmed', -- confirmed, cancelled, completed
    access_token_hash VARCHAR(255) NOT NULL,
    token_expires_at TIMESTAMP NOT NULL,
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (service_id) REFERENCES services(id),
    FOREIGN KEY (staff_id) REFERENCES staff(id)
);

CREATE INDEX IF NOT EXISTS idx_appointments_start ON appointments(start_at);
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_appointments_token ON appointments(access_token_hash);

-- メール送信ログ
CREATE TABLE IF NOT EXISTS email_logs (
    id SERIAL PRIMARY KEY,
    appointment_id INTEGER,
    recipient_email VARCHAR(255) NOT NULL,
    subject VARCHAR(500) NOT NULL,
    body TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, sent, failed
    error_message TEXT,
    sent_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_email_logs_appointment ON email_logs(appointment_id);



-- システム設定
CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 営業時間
CREATE TABLE IF NOT EXISTS business_hours (
    id SERIAL PRIMARY KEY,
    day_of_week INTEGER NOT NULL, -- 0=日曜, 1=月曜, ..., 6=土曜
    open_time TIME, -- NULLなら休診
    close_time TIME,
    morning_open TIME,     -- 午前診療開始
    morning_close TIME,    -- 午前診療終了
    afternoon_open TIME,   -- 午後診療開始
    afternoon_close TIME,  -- 午後診療終了
    is_closed BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE(day_of_week)
);

-- 休診日（祝日・臨時休診）
CREATE TABLE IF NOT EXISTS holidays (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL UNIQUE,
    name VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);

-- スケジュール例外（臨時休業・時間帯変更・特別営業）
-- exception_type: 
--   'closed' = 臨時休業（終日）
--   'partial_closed' = 時間帯休業（特定の時間帯のみ休業）
--   'modified_hours' = 営業時間変更（通常とは異なる営業時間）
--   'special_open' = 特別営業（通常休診日だが臨時で営業）
CREATE TABLE IF NOT EXISTS schedule_exceptions (
    id SERIAL PRIMARY KEY,
    exception_type VARCHAR(50) NOT NULL DEFAULT 'closed',
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    start_time TIME,  -- partial_closed/modified_hours時に使用
    end_time TIME,    -- partial_closed/modified_hours時に使用
    morning_open TIME,     -- modified_hours時の午前開始時間
    morning_close TIME,    -- modified_hours時の午前終了時間
    afternoon_open TIME,   -- modified_hours時の午後開始時間
    afternoon_close TIME,  -- modified_hours時の午後終了時間
    reason VARCHAR(255),
    notes TEXT,
    is_recurring BOOLEAN NOT NULL DEFAULT FALSE,  -- 毎年繰り返すかどうか
    created_by INTEGER,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    FOREIGN KEY (created_by) REFERENCES admins(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_schedule_exceptions_dates ON schedule_exceptions(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_schedule_exceptions_type ON schedule_exceptions(exception_type);

