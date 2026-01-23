/**
 * データベース初期化スクリプト
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'clinic.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

function initDatabase() {
    console.log('🗄️  データベースを初期化しています...');

    // 既存のDBがあれば削除（開発用）
    if (fs.existsSync(DB_PATH)) {
        console.log('⚠️  既存のデータベースを削除します');
        fs.unlinkSync(DB_PATH);
    }

    const db = new Database(DB_PATH);

    // 外部キー制約を有効化
    db.pragma('foreign_keys = ON');

    // スキーマを読み込んで実行
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    db.exec(schema);

    console.log('✅ データベースの初期化が完了しました');
    console.log(`📁 データベースファイル: ${DB_PATH}`);

    db.close();
}

initDatabase();
