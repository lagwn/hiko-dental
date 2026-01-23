#!/bin/bash
# マニュアル素材をコピーするスクリプト

SRC="/Users/naoya/.gemini/antigravity/brain/0dbf5dd6-e06d-42bb-b3a8-5939db394774"
DEST="/Users/naoya/Desktop/クライアント1119/彦歯科医院/予約システム/manual_assets"

mkdir -p "$DEST"

# マニュアルをコピー
cp "/Users/naoya/Desktop/クライアント1119/彦歯科医院/予約システム/MANUAL.md" "$DEST/"

# スクリーンショットをコピー（リネーム）
cp "$SRC/booking_top_1769008975254.png" "$DEST/booking_top.png"
cp "$SRC/admin_login_1769009010813.png" "$DEST/admin_login.png"
cp "$SRC/admin_calendar_1769009043897.png" "$DEST/admin_calendar.png"
cp "$SRC/admin_patients_1769009075671.png" "$DEST/admin_patients.png"
cp "$SRC/admin_doctors_1769009110602.png" "$DEST/admin_doctors.png"
cp "$SRC/admin_services_1769009145239.png" "$DEST/admin_services.png"
cp "$SRC/admin_accounts_1769009185551.png" "$DEST/admin_accounts.png"
cp "$SRC/admin_settings_upper_1769009222702.png" "$DEST/admin_settings_upper.png"
cp "$SRC/admin_settings_lower_1769009283819.png" "$DEST/admin_settings_lower.png"

echo "コピー完了！"
ls -la "$DEST"
