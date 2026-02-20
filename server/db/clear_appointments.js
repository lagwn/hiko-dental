/**
 * 予約データ削除スクリプト
 * appointmentsテーブルを空にします
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const { Pool, neonConfig } = require('@neondatabase/serverless');
const ws = require('ws');

// WebSocket設定
neonConfig.webSocketConstructor = ws;

async function clearAppointments() {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

    if (!connectionString) {
        console.error('❌ DATABASE_URLまたはPOSTGRES_URL環境変数が設定されていません');
        process.exit(1);
    }

    const pool = new Pool({ connectionString });

    console.log('🗑️ 予約データを削除します...');

    try {
        await pool.query('TRUNCATE TABLE appointments CASCADE');
        console.log('✅ 予約データを全て削除しました');
    } catch (error) {
        console.error('❌ エラーが発生しました:', error.message);
    } finally {
        await pool.end();
    }
}

clearAppointments();
