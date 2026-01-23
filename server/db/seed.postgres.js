/**
 * PostgreSQL用初期データ投入スクリプト
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { Pool } = require('@neondatabase/serverless');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

async function seed() {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

    if (!connectionString) {
        console.error('❌ DATABASE_URLまたはPOSTGRES_URL環境変数が設定されていません');
        process.exit(1);
    }

    const pool = new Pool({ connectionString });

    console.log('🌱 PostgreSQLシードデータ投入を開始します...');

    try {
        // スキーマ実行
        const schemaPath = path.join(__dirname, 'schema.postgres.sql');
        const schema = fs.readFileSync(schemaPath, 'utf-8');

        console.log('📋 スキーマを作成中...');
        await pool.query(schema);
        console.log('✅ スキーマを作成しました');

        // 診療メニュー
        const services = [
            [1, '初診', '初めての方の診察・カウンセリング', 60, 1],
            [2, '再診', '継続治療の診察', 30, 2],
            [3, 'クリーニング', '歯のクリーニング・歯石除去', 45, 3],
            [4, '定期検診', '定期的な口腔内チェック', 30, 4],
            [5, '虫歯治療', '虫歯の治療', 30, 5],
            [6, 'ホワイトニング', '歯のホワイトニング', 60, 6],
        ];

        for (const [id, name, description, duration, sortOrder] of services) {
            await pool.query(`
                INSERT INTO services (id, name, description, duration_minutes, sort_order)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (id) DO NOTHING
            `, [id, name, description, duration, sortOrder]);
        }
        // シーケンス更新
        await pool.query(`SELECT setval('services_id_seq', (SELECT MAX(id) FROM services))`);
        console.log('✅ 診療メニューを登録しました');

        // スタッフ
        const staffMembers = [
            [1, '彦 太郎', '院長', 1],
            [2, '山田 花子', '歯科医師', 2],
            [3, '鈴木 一郎', '歯科衛生士', 3],
        ];

        for (const [id, name, title, sortOrder] of staffMembers) {
            await pool.query(`
                INSERT INTO staff (id, name, title, sort_order)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (id) DO NOTHING
            `, [id, name, title, sortOrder]);
        }
        await pool.query(`SELECT setval('staff_id_seq', (SELECT MAX(id) FROM staff))`);
        console.log('✅ スタッフを登録しました');

        // 管理者（初期パスワード: admin123）
        const SALT_ROUNDS = 10;
        const adminPassword = await bcrypt.hash('admin123', SALT_ROUNDS);

        await pool.query(`
            INSERT INTO admins (id, username, password_hash, display_name)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (id) DO NOTHING
        `, [1, 'admin', adminPassword, '管理者']);
        await pool.query(`SELECT setval('admins_id_seq', (SELECT MAX(id) FROM admins))`);
        console.log('✅ 管理者アカウントを登録しました（ユーザー名: admin, パスワード: admin123）');

        // 営業時間（月〜土 9:00-18:00、日曜休診）
        const businessHours = [
            [0, null, null, true],        // 日曜：休診
            [1, '09:00', '18:00', false],  // 月曜
            [2, '09:00', '18:00', false],  // 火曜
            [3, '09:00', '18:00', false],  // 水曜
            [4, '09:00', '18:00', false],  // 木曜
            [5, '09:00', '18:00', false],  // 金曜
            [6, '09:00', '13:00', false],  // 土曜（午前のみ）
        ];

        for (const [dayOfWeek, openTime, closeTime, isClosed] of businessHours) {
            await pool.query(`
                INSERT INTO business_hours (day_of_week, open_time, close_time, is_closed)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (day_of_week) DO UPDATE SET
                    open_time = EXCLUDED.open_time,
                    close_time = EXCLUDED.close_time,
                    is_closed = EXCLUDED.is_closed
            `, [dayOfWeek, openTime, closeTime, isClosed]);
        }
        console.log('✅ 営業時間を登録しました');

        // システム設定
        const settings = [
            ['clinic_name', '彦歯科医院', '医院名'],
            ['clinic_phone', '03-1234-5678', '電話番号'],
            ['clinic_address', '東京都○○区△△1-2-3', '住所'],
            ['booking_cutoff_days', '2', '予約締切日数'],
            ['booking_cutoff_hours', '3', '予約締切時間'],
            ['booking_max_days_ahead', '60', '最遠予約日数'],
            ['slot_duration_minutes', '30', 'スロット間隔（分）'],
            ['lunch_start', '12:00', '昼休み開始'],
            ['lunch_end', '13:00', '昼休み終了'],
        ];

        for (const [key, value, description] of settings) {
            await pool.query(`
                INSERT INTO settings (key, value, description)
                VALUES ($1, $2, $3)
                ON CONFLICT (key) DO UPDATE SET
                    value = EXCLUDED.value,
                    description = EXCLUDED.description,
                    updated_at = NOW()
            `, [key, value, description]);
        }
        console.log('✅ システム設定を登録しました');

        console.log('\n🎉 シードデータの投入が完了しました！');

    } catch (error) {
        console.error('❌ エラーが発生しました:', error.message);
        throw error;
    } finally {
        await pool.end();
    }
}

// 実行
seed().catch((err) => {
    console.error(err);
    process.exit(1);
});
