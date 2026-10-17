#!/usr/bin/env bash
#
# MailFlow 构建/部署脚本（Ubuntu / Debian）
#
# 步骤：
#   1) 校验以 root 运行
#   2) 停止 mail-flow 服务
#   3) 检查前后端 npm 依赖（缺失则自动安装）
#   4) 构建前端
#   5) 设置后端目录权限 mail-flow:mail-flow
#   6) 部署前端产物到 /var/www/mail-flow 并设置权限 caddy:caddy
#   7) 启动 mail-flow 服务
#
# 用法（在仓库根目录执行）：
#   sudo ./deploy.sh
#
# 说明：后端目录保持仓库内 Backend/ 原位置不变；前端 dist 拷贝到 Caddy 站点根目录。

set -euo pipefail

# ===== 可配置项 =====
SERVICE_NAME="mail-flow"        # systemd 服务名
BACKEND_USER="mail-flow"        # 后端运行用户/组
BACKEND_GROUP="mail-flow"
WEB_USER="caddy"                # 前端托管用户/组
WEB_GROUP="caddy"
WEB_ROOT="/var/www/mail-flow"   # Caddy 站点根目录
MIN_NODE_MAJOR=22               # 与 Backend/package.json engines.node 对齐
MIN_NODE_MINOR=5

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT/Backend"
FRONTEND_DIR="$ROOT/Frontend"
FRONTEND_DIST="$FRONTEND_DIR/dist"

log()  { echo "[*] $*"; }
step() { echo; echo "==== [$1/7] $2 ===="; }
fail() { echo "[失败] $1" >&2; exit 1; }

unit_exists() {
  systemctl list-unit-files 2>/dev/null | grep -q "^${SERVICE_NAME}\.service"
}

# ---- 1. 校验运行身份 ----
step 1 "校验运行身份"
[ "$(id -u)" -eq 0 ] || fail "需要 root 权限，请用 sudo 运行：sudo $0"
log "已以 root 运行"

# ---- 2. 停止服务 ----
step 2 "停止服务 $SERVICE_NAME"
if unit_exists; then
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    systemctl stop "$SERVICE_NAME"
    log "已停止 $SERVICE_NAME"
  else
    log "$SERVICE_NAME 未在运行，跳过"
  fi
else
  log "未找到 $SERVICE_NAME 服务单元，跳过停止（将在启动步骤再次确认）"
fi

# ---- 3. 检查 npm 依赖 ----
step 3 "检查前后端 npm 依赖"
command -v node >/dev/null 2>&1 || fail "未找到 node，请先安装 Node.js >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}.0"
command -v npm  >/dev/null 2>&1 || fail "未找到 npm（通常随 Node.js 安装）"

node_raw="$(node -v 2>/dev/null || true)"
[ -n "$node_raw" ] || fail "无法获取 Node.js 版本"
node_ver="${node_raw#v}"; node_ver="${node_ver%%-*}"
major="${node_ver%%.*}"; rest="${node_ver#*.}"; minor="${rest%%.*}"
major="${major:-0}"; minor="${minor:-0}"
case "$major$minor" in
  *[!0-9]*) fail "无法解析 Node.js 版本：$node_raw" ;;
esac
if [ "$major" -lt "$MIN_NODE_MAJOR" ] || { [ "$major" -eq "$MIN_NODE_MAJOR" ] && [ "$minor" -lt "$MIN_NODE_MINOR" ]; }; then
  fail "Node.js 版本过低：$node_raw（要求 >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}.0）"
fi
log "Node.js $node_raw，npm $(npm -v)"

install_deps() {
  local dir="$1" name="$2"
  [ -f "$dir/package.json" ] || fail "未找到 $name package.json：$dir/package.json"
  if [ -d "$dir/node_modules" ]; then
    log "$name 依赖已存在（node_modules），跳过安装"
    return
  fi
  log "$name 缺少 node_modules，开始安装 ..."
  if [ -f "$dir/package-lock.json" ]; then
    ( cd "$dir" && npm ci )
  else
    ( cd "$dir" && npm install )
  fi
}

install_deps "$BACKEND_DIR"  "后端"
install_deps "$FRONTEND_DIR" "前端"

# ---- 4. 构建前端 ----
step 4 "构建前端"
[ -d "$FRONTEND_DIR" ] || fail "未找到前端目录：$FRONTEND_DIR"
( cd "$FRONTEND_DIR" && npm run build )
[ -f "$FRONTEND_DIST/index.html" ] || fail "未生成前端产物：$FRONTEND_DIST/index.html"
log "前端构建完成：$FRONTEND_DIST"

# ---- 5. 后端目录权限 ----
step 5 "设置后端目录权限 ${BACKEND_USER}:${BACKEND_GROUP}"
[ -d "$BACKEND_DIR" ] || fail "未找到后端目录：$BACKEND_DIR"
chown -R "${BACKEND_USER}:${BACKEND_GROUP}" "$BACKEND_DIR"
log "已设置 $BACKEND_DIR → ${BACKEND_USER}:${BACKEND_GROUP}"

# ---- 6. 前端产物权限 ----
step 6 "部署前端产物到 $WEB_ROOT 并设置权限 ${WEB_USER}:${WEB_GROUP}"
mkdir -p "$WEB_ROOT"
# 清空旧产物（含隐藏文件），保留目录本身
find "$WEB_ROOT" -mindepth 1 -delete
cp -R "$FRONTEND_DIST/." "$WEB_ROOT/"
chown -R "${WEB_USER}:${WEB_GROUP}" "$WEB_ROOT"
log "已部署 $FRONTEND_DIST → $WEB_ROOT（${WEB_USER}:${WEB_GROUP}）"

# ---- 7. 启动服务 ----
step 7 "启动服务 $SERVICE_NAME"
unit_exists || fail "未找到 $SERVICE_NAME 服务单元，请先创建 systemd 单元后再运行"
systemctl start "$SERVICE_NAME"
if systemctl is-active --quiet "$SERVICE_NAME"; then
  log "$SERVICE_NAME 已启动"
else
  fail "$SERVICE_NAME 启动失败，请执行：systemctl status $SERVICE_NAME"
fi

echo
log "部署完成："
log "  后端：$BACKEND_DIR（${BACKEND_USER}:${BACKEND_GROUP}）"
log "  前端：$WEB_ROOT（${WEB_USER}:${WEB_GROUP}）"
log "  服务：$SERVICE_NAME（$(systemctl is-active "$SERVICE_NAME")）"
