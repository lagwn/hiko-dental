-- 予約枠キャパシティ機能用マイグレーション
-- 実行日: 2026-01-24

-- 1. settings テーブルにデフォルトキャパシティを追加
INSERT INTO settings (key, value, description) 
VALUES ('default_slot_capacity', '1', '時間枠あたりのデフォルト予約上限数')
ON CONFLICT (key) DO UPDATE SET value = '1';

-- 2. slot_capacities テーブル作成（曜日×時間帯ごとの個別設定）
CREATE TABLE IF NOT EXISTS slot_capacities (
    id SERIAL PRIMARY KEY,
    day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
    time_slot TIME NOT NULL,
    capacity INTEGER NOT NULL DEFAULT 1 CHECK (capacity >= 1),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(day_of_week, time_slot)
);

-- インデックス追加
CREATE INDEX IF NOT EXISTS idx_slot_capacities_day_time ON slot_capacities(day_of_week, time_slot);

-- 確認用: テーブル説明
COMMENT ON TABLE slot_capacities IS '曜日×時間帯ごとの予約枠キャパシティ設定';
COMMENT ON COLUMN slot_capacities.day_of_week IS '曜日 (0=日, 1=月, ..., 6=土)';
COMMENT ON COLUMN slot_capacities.time_slot IS '時間枠 (09:00, 09:30, etc.)';
COMMENT ON COLUMN slot_capacities.capacity IS '同時予約可能数';
