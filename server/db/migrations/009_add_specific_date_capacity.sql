-- 特定日付のキャパシティ設定追加
-- 実行日: 2026-01-24

-- 1. specific_date カラムを追加
ALTER TABLE slot_capacities ADD COLUMN IF NOT EXISTS specific_date DATE DEFAULT NULL;

-- 2. day_of_week を NULL 許可に変更（特定日の場合は曜日指定なしもあり得るため）
ALTER TABLE slot_capacities ALTER COLUMN day_of_week DROP NOT NULL;

-- 3. check制約は day_of_week がある場合のみ適用されるのでそのままで良いが、念のため論理的には
-- 「day_of_weekかspecific_dateのどちらかは必須」という制約が良いが、複雑になるのでアプリ側で制御。

-- 4. 特定日用のユニーク制約追加
CREATE UNIQUE INDEX IF NOT EXISTS idx_slot_capacities_date_time ON slot_capacities(specific_date, time_slot) WHERE specific_date IS NOT NULL;

-- 確認用
COMMENT ON COLUMN slot_capacities.specific_date IS '特定日付 (NULLなら曜日設定)';
