#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo '请以 root 执行'; exit 1; }
TARGET=/opt/jjjshop-dining/backend
SOURCE=$(cd "$(dirname "$0")" && pwd)
[[ -f "$TARGET/dining-config.php" && -f "$TARGET/app/dining/service/Dining.php" ]] || { echo '未找到已安装的接单版，请先安装v0.1'; exit 1; }
exec 9>/run/lock/dining-update.lock
flock -n 9 || { echo '另一个更新正在进行'; exit 1; }
for name in Dining.php app.js app.css index.html staff.html; do [[ -f "$SOURCE/$name" ]] || { echo "缺少 $name"; exit 1; }; done
php -l "$SOURCE/Dining.php"
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP="/var/backups/jjjshop-dining/update-$STAMP"
install -d -m 700 "$BACKUP"
cp -a "$TARGET/app/dining/service/Dining.php" "$BACKUP/"
cp -a "$TARGET/public/dining" "$BACKUP/public-dining"
install -d -o www-data -g www-data -m 700 "$TARGET/runtime/dining-sessions"
# Only application files change. No database statements, menus, orders or credentials are overwritten.
install -o root -g www-data -m 640 "$SOURCE/Dining.php" "$TARGET/app/dining/service/Dining.php.next"
mv "$TARGET/app/dining/service/Dining.php.next" "$TARGET/app/dining/service/Dining.php"
for name in app.js app.css index.html staff.html; do
 install -o root -g www-data -m 640 "$SOURCE/$name" "$TARGET/public/dining/$name.next"
 mv "$TARGET/public/dining/$name.next" "$TARGET/public/dining/$name"
done
if ! systemctl reload php8.3-fpm || ! curl -fsS --max-time 10 http://127.0.0.1:8081/dining/staff.html >/dev/null; then
 cp -a "$BACKUP/Dining.php" "$TARGET/app/dining/service/Dining.php"
 cp -a "$BACKUP/public-dining/." "$TARGET/public/dining/"
 systemctl reload php8.3-fpm || true
 echo '检查未通过，已恢复更新前文件'; exit 1
fi
printf 'v0.3 更新完成。原文件备份：%s\n' "$BACKUP"
echo '刷新顾客和店员页面；店员首次需重新登录一次，设备保持登录最多30天。'
echo '默认桌台总览；点桌台看详情；仅打印桌码需要切换页面，无手动开桌。'
