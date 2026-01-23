/**
 * データベース初期データ投入スクリプト
 */

const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');

const DB_PATH = path.join(__dirname, 'clinic.db');

async function seed() {
    const db = new Database(DB_PATH);
    
    // 外部キー制約を有効化
    db.pragma('foreign_keys = ON');
    
    console.log('🌱 シードデータ投入を開始します...');

    try {
        // トランザクション開始
        db.exec('BEGIN TRANSACTION');

        // 診療メニュー
        const insertService = db.prepare(`
            INSERT OR IGNORE INTO services (id, name, description, duration_minutes, sort_order)
            VALUES (?, ?, ?, ?, ?)
        `);
        
        const services = [
            [1, '初診', '初めての方の診察・カウンセリング', 60, 1],
            [2, '再診', '継続治療の診察', 30, 2],
            [3, 'クリーニング', '歯のクリーニング・歯石除去', 45, 3],
            [4, '定期検診', '定期的な口腔内チェック', 30, 4],
            [5, '虫歯治療', '虫歯の治療', 30, 5],
            [6, 'ホワイトニング', '歯のホワイトニング', 60, 6],
        ];
        
        for (const service of services) {
            insertService.run(...service);
        }
        console.log('✅ 診療メニューを登録しました');

        // スタッフ
        const insertStaff = db.prepare(`
            INSERT OR IGNORE INTO staff (id, name, title, sort_order)
            VALUES (?, ?, ?, ?)
        `);
        
        const staffMembers = [
            [1, '彦 太郎', '院長', 1],
            [2, '山田 花子', '歯科医師', 2],
            [3, '鈴木 一郎', '歯科衛生士', 3],
        ];
        
        for (const staff of staffMembers) {
            insertStaff.run(...staff);
        }
        console.log('✅ スタッフを登録しました');

        // 管理者（初期パスワード: admin123）
        const SALT_ROUNDS = 10;
        const adminPassword = await bcrypt.hash('admin123', SALT_ROUNDS);
        
        const insertAdmin = db.prepare(`
            INSERT OR IGNORE INTO admins (id, username, password_hash, display_name)
            VALUES (?, ?, ?, ?)
        `);
        
        insertAdmin.run(1, 'admin', adminPassword, '管理者');
        console.log('✅ 管理者アカウントを登録しました（ユーザー名: admin, パスワード: admin123）');

        // 営業時間（月〜土 9:00-18:00、日曜休診）
        const insertHours = db.prepare(`
            INSERT OR REPLACE INTO business_hours (day_of_week, open_time, close_time, is_closed)
            VALUES (?, ?, ?, ?)
        `);
        
        const businessHours = [
            [0, null, null, 1],        // 日曜：休診
            [1, '09:00', '18:00', 0],  // 月曜
            [2, '09:00', '18:00', 0],  // 火曜
            [3, '09:00', '18:00', 0],  // 水曜
            [4, '09:00', '18:00', 0],  // 木曜
            [5, '09:00', '18:00', 0],  // 金曜
            [6, '09:00', '13:00', 0],  // 土曜（午前のみ）
        ];
        
        for (const hours of businessHours) {
            insertHours.run(...hours);
        }
        console.log('✅ 営業時間を登録しました');

        // システム設定
        const insertSetting = db.prepare(`
            INSERT OR REPLACE INTO settings (key, value, description)
            VALUES (?, ?, ?)
        `);
        
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
        
        for (const setting of settings) {
            insertSetting.run(...setting);
        }
        console.log('✅ システム設定を登録しました');

        // コミット
        db.exec('COMMIT');
        console.log('\n🎉 シードデータの投入が完了しました！');

    } catch (error) {
        db.exec('ROLLBACK');
        console.error('❌ エラーが発生しました:', error.message);
        throw error;
    } finally {
        db.close();
    }
}

// 実行
seed().catch(console.error);
