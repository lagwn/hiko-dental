/**
 * セキュリティユーティリティ
 */

const crypto = require('crypto');
const bcrypt = require('bcrypt');

const SALT_ROUNDS = 10;
const TOKEN_BYTES = 32;
const TOKEN_EXPIRY_DAYS = 30;

/**
 * ランダムなアクセストークンを生成
 * @returns {string} Base64エンコードされたトークン
 */
function generateAccessToken() {
    return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * トークンをSHA-256でハッシュ化
 * @param {string} token - 平文トークン
 * @returns {string} ハッシュ化されたトークン
 */
function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * トークンの有効期限を計算
 * @param {number} days - 有効日数
 * @returns {Date} 有効期限
 */
function calculateTokenExpiry(days = TOKEN_EXPIRY_DAYS) {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + days);
    return expiry;
}

/**
 * パスワードをbcryptでハッシュ化
 * @param {string} password - 平文パスワード
 * @returns {Promise<string>} ハッシュ化されたパスワード
 */
async function hashPassword(password) {
    return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * パスワードを検証
 * @param {string} password - 平文パスワード
 * @param {string} hash - ハッシュ化されたパスワード
 * @returns {Promise<boolean>} 一致するかどうか
 */
async function verifyPassword(password, hash) {
    return bcrypt.compare(password, hash);
}

/**
 * HTMLエスケープ（XSS対策）
 * @param {string} str - エスケープする文字列
 * @returns {string} エスケープされた文字列
 */
function escapeHtml(str) {
    if (typeof str !== 'string') return str;
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
    };
    return str.replace(/[&<>"']/g, char => map[char]);
}

/**
 * 入力値をサニタイズ
 * @param {string} str - サニタイズする文字列
 * @returns {string} サニタイズされた文字列
 */
function sanitize(str) {
    if (typeof str !== 'string') return str;
    return str.trim();
}

/**
 * 電話番号のバリデーション
 * @param {string} phone - 電話番号
 * @returns {boolean} 有効かどうか
 */
function isValidPhone(phone) {
    if (!phone) return false;
    // ハイフンなし・ありの両方に対応（10-11桁）
    const cleaned = phone.replace(/[-\s]/g, '');
    return /^0\d{9,10}$/.test(cleaned);
}

/**
 * メールアドレスのバリデーション
 * @param {string} email - メールアドレス
 * @returns {boolean} 有効かどうか
 */
function isValidEmail(email) {
    if (!email) return true; // 任意項目
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * ふりがなのバリデーション（ひらがな・カタカナ・スペース）
 * @param {string} kana - ふりがな
 * @returns {boolean} 有効かどうか
 */
function isValidKana(kana) {
    if (!kana) return false;
    // ひらがな、カタカナ、長音、スペースを許可
    return /^[\u3040-\u309F\u30A0-\u30FF\u30FC\s]+$/.test(kana);
}

/**
 * 予約データのバリデーション
 * @param {Object} data - 予約データ
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateAppointmentData(data) {
    const errors = [];

    if (!data.name || data.name.trim().length === 0) {
        errors.push('氏名は必須です');
    }

    if (!data.kana || data.kana.trim().length === 0) {
        errors.push('ふりがなは必須です');
    } else if (!isValidKana(data.kana)) {
        errors.push('ふりがなはひらがなまたはカタカナで入力してください');
    }

    if (!data.phone) {
        errors.push('電話番号は必須です');
    } else if (!isValidPhone(data.phone)) {
        errors.push('有効な電話番号を入力してください');
    }

    if (data.email && !isValidEmail(data.email)) {
        errors.push('有効なメールアドレスを入力してください');
    }

    if (!data.serviceId) {
        errors.push('メニューを選択してください');
    }

    if (!data.startAt) {
        errors.push('予約日時を選択してください');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * CSRFトークン生成
 * @returns {string} CSRFトークン
 */
function generateCsrfToken() {
    return crypto.randomBytes(32).toString('hex');
}

module.exports = {
    generateAccessToken,
    hashToken,
    calculateTokenExpiry,
    hashPassword,
    verifyPassword,
    escapeHtml,
    sanitize,
    isValidPhone,
    isValidEmail,
    isValidKana,
    validateAppointmentData,
    generateCsrfToken,
    TOKEN_EXPIRY_DAYS
};
