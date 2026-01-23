/**
 * データベース接続モジュール（PostgreSQL）
 * Neon/Vercel Postgres対応
 */

const { Pool, neonConfig } = require('@neondatabase/serverless');

// Vercel Edge Runtime対応
if (process.env.VERCEL) {
    neonConfig.fetchConnectionCache = true;
}

// 接続プール
let pool = null;

function getPool() {
    if (!pool) {
        const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

        if (!connectionString) {
            throw new Error('DATABASE_URLまたはPOSTGRES_URL環境変数が設定されていません');
        }

        pool = new Pool({
            connectionString,
            max: 10,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000,
        });

        pool.on('error', (err) => {
            console.error('PostgreSQL pool error:', err);
        });
    }
    return pool;
}

/**
 * クエリ実行（単一行取得）
 */
async function queryOne(sql, params = []) {
    const pool = getPool();
    const result = await pool.query(sql, params);
    return result.rows[0] || null;
}

/**
 * クエリ実行（全行取得）
 */
async function queryAll(sql, params = []) {
    const pool = getPool();
    const result = await pool.query(sql, params);
    return result.rows;
}

/**
 * クエリ実行（挿入/更新/削除）
 */
async function execute(sql, params = []) {
    const pool = getPool();
    const result = await pool.query(sql, params);
    return {
        rowCount: result.rowCount,
        rows: result.rows
    };
}

/**
 * 挿入してIDを返す
 */
async function insert(sql, params = []) {
    // RETURNING id を追加していない場合は追加
    const sqlWithReturning = sql.includes('RETURNING') ? sql : sql + ' RETURNING id';
    const pool = getPool();
    const result = await pool.query(sqlWithReturning, params);
    return result.rows[0]?.id || null;
}

/**
 * トランザクション実行
 */
async function transaction(callback) {
    const pool = getPool();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

/**
 * プール終了
 */
async function closePool() {
    if (pool) {
        await pool.end();
        pool = null;
    }
}

module.exports = {
    getPool,
    queryOne,
    queryAll,
    execute,
    insert,
    transaction,
    closePool
};
