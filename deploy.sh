#!/usr/bin/env bash
#
# MailFlow 构建/部署脚本（Ubuntu / Debian，systemd）
#
# 部署形态：
#   后端 —— 直接在仓库内 Backend/ 运行，不复制到别处；由 systemd 服务 mail-flow 托管
#   前端 —— Frontend/dist 构建产物部署到 Caddy 站点根目录
#
# 用法（在仓库根目录执行）：
#   sudo ./deploy.sh
#
#   可选环境变量：
#   NPM_REGISTRY=https://registry.npmjs.org  sudo ./deploy.sh   # 指定依赖源

set -euo pipefail

# ===== 可配置项 =====
SERVICE_NAME="mail-flow"          # systemd 服务名
BACKEND_USER="mail-flow"          # 后端运行用户/组
BACKEND_GROUP="mail-flow"
WEB_USER="caddy"                  # 前端托管用户/组
WEB_GROUP="caddy"
WEB_ROOT="/var/www/mail-flow"     # Caddy 站点根目录
MIN_NODE_MAJOR=22                 # 与 Backend/package.json engines.node 对齐
MIN_NODE_MINOR=5

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT/Backend"
FRONTEND_DIR="$ROOT/Frontend"
FRONTEND_DIST="$FRONTEND_DIR/dist"
ENV_FILE="$BACKEND_DIR/.env"
UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

log()  { echo "[*] $*"; }
warn() { echo "[!] $*" >&2; }
step() { echo; echo "==== [$1/8] $2 ===="; }
fail() { echo "[失败] $1" >&2; exit 1; }

# 服务单元判定：直接问 systemd 要单元内容，不经管道。
#
# 注意：绝不要用 `systemctl list-unit-files | grep -q ...`。
# 本脚本启用了 `set -o pipefail`，而 grep -q 命中首个匹配就退出，
# 此时 systemctl 仍在枚举并写管道，会收到 SIGPIPE 以 141 退出，
# 导致整个管道被判为失败，从而误报“未找到服务单元”。
# 这与输出量无关：只要匹配项不在末尾就会触发。
unit_exists() {
  systemctl cat "${SERVICE_NAME}.service" >/dev/null 2>&1
}

svc_active() {
  systemctl is-active --quiet "$SERVICE_NAME"
}

# 从 lockfile 的 resolved 字段推断 registry 源，使 npm 实际使用的源与 lockfile 一致。
#
# npm 12 默认 allow-remote=none，只允许从“当前配置的 registry”下载。若配置源与
# lockfile 中 resolved 的 origin 不同，这些正常的 registry 包会被误判为 remote
# 直连 URL 并拒绝下载，报 EALLOWREMOTE（npm/cli#9548）。
lock_registry() {
  local lock="$1" origins
  [ -f "$lock" ] || return 0
  # 用变量承接，避免 pipefail 下下游提前退出产生 SIGPIPE
  origins="$(sed -n 's/.*"resolved": *"\(https\?:\/\/[^"]*\)".*/\1/p' "$lock" 2>/dev/null \
    | sed -n 's#^\(https\?://[^/]*\)/.*#\1#p')" || return 0
  [ -n "$origins" ] || return 0
  printf '%s\n' "$origins" | sort | uniq -c | sort -rn | awk 'NR==1{print $2}'
}

npm_major_ge_12() {
  local v
  v="$(npm -v 2>/dev/null || true)"
  v="${v%%.*}"
  case "$v" in ''|*[!0-9]*) return 1 ;; esac
  [ "$v" -ge 12 ]
}

# ============================================================================
# 1. 校验运行身份
# ============================================================================
step 1 "校验运行身份"
[ "$(id -u)" -eq 0 ] || fail "需要 root 权限，请用 sudo 运行：sudo $0"
log "已以 root 运行"

# ============================================================================
# 2. 预检（不通过则直接退出，避免停服后才失败）
# ============================================================================
step 2 "预检目录、配置与服务单元"

[ -d "$BACKEND_DIR" ]  || fail "未找到后端目录：$BACKEND_DIR"
[ -d "$FRONTEND_DIR" ] || fail "未找到前端目录：$FRONTEND_DIR"
log "后端目录：$BACKEND_DIR"
log "前端目录：$FRONTEND_DIR"

# .env 是后端启动的硬性前提（config.js 缺 APP_SECRET / AUTH_PASSWORD 会直接抛错）
if [ ! -f "$ENV_FILE" ]; then
  fail "缺少 $ENV_FILE。请先创建：
       cp $BACKEND_DIR/.env.example $ENV_FILE
       然后填写 APP_SECRET 与 AUTH_PASSWORD（APP_SECRET 用随机长字符串）"
fi
log "环境文件：$ENV_FILE"

# 用非 root 身份验证运行用户确实读得到 .env（属主/权限不对时会在此暴露）
if command -v runuser >/dev/null 2>&1; then
  runuser -u "$BACKEND_USER" -- test -r "$ENV_FILE" \
    || fail "$BACKEND_USER 无法读取 $ENV_FILE，请检查属主与权限（建议 chown ${BACKEND_USER}:${BACKEND_GROUP} $ENV_FILE && chmod 640 $ENV_FILE）"
  log "$BACKEND_USER 可读取 .env"
fi

# 服务单元
unit_exists || fail "未找到 systemd 服务单元：$UNIT_FILE
       请先创建该单元，例如：
       [Unit]
       Description=MailFlow
       After=network.target network-online.target
       Wants=network-online.target

       [Service]
       Type=simple
       User=${BACKEND_USER}
       Group=${BACKEND_GROUP}
       WorkingDirectory=$BACKEND_DIR
       ExecStart=/usr/bin/npm start
       Restart=always
       RestartSec=30
       StandardOutput=journal
       StandardError=journal
       SyslogIdentifier=${SERVICE_NAME}

       [Install]
       WantedBy=multi-user.target"

# 单元里的 WorkingDirectory 必须指向仓库内的 Backend/，否则服务跑的不是这份代码
unit_wd="$(systemctl show -p WorkingDirectory --value "$SERVICE_NAME" 2>/dev/null || true)"
if [ -n "$unit_wd" ] && [ "$unit_wd" != "$BACKEND_DIR" ]; then
  warn "服务单元的 WorkingDirectory 是 $unit_wd，与本脚本部署的后端目录 $BACKEND_DIR 不一致"
  warn "服务将运行 $unit_wd 下的代码。如需一致，请修改 $UNIT_FILE 后执行：systemctl daemon-reload"
fi
log "服务单元：$UNIT_FILE"

# 用户与组
id "$BACKEND_USER" >/dev/null 2>&1 || fail "系统用户不存在：$BACKEND_USER"
id "$WEB_USER"     >/dev/null 2>&1 || fail "系统用户不存在：$WEB_USER"
log "运行用户：$BACKEND_USER，前端托管用户：$WEB_USER"

# ============================================================================
# 3. 检查 Node.js 与 npm 依赖
# ============================================================================
step 3 "检查 Node.js 与 npm 依赖"

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
log "npm registry：$(npm config get registry)"

install_deps() {
  local dir="$1" name="$2"
  [ -f "$dir/package.json" ] || fail "未找到 $name package.json：$dir/package.json"
  if [ -d "$dir/node_modules" ]; then
    log "$name 依赖已存在（node_modules），跳过安装"
    return
  fi

  local -a args=()
  local lock="$dir/package-lock.json"
  if [ -f "$lock" ]; then
    args=(ci)
    local reg
    reg="${NPM_REGISTRY:-$(lock_registry "$lock")}"
    if [ -n "$reg" ]; then
      log "$name 按 lockfile 使用 registry 源：$reg"
      args+=("--registry=$reg")
    fi
  else
    args=(install)
  fi

  log "$name 缺少 node_modules，开始安装：npm ${args[*]}"
  if ! ( cd "$dir" && npm "${args[@]}" ); then
    # 兜底：仍失败且确属 npm 12 的 allow-remote 拦截时，对本次安装放开限制重试
    if [ -f "$lock" ] && npm_major_ge_12; then
      warn "$name 安装失败，尝试以 npm_config_allow_remote=all 重试 ..."
      ( cd "$dir" && npm_config_allow_remote=all npm "${args[@]}" ) \
        || fail "$name 依赖安装失败，请检查上方 npm 输出"
    else
      fail "$name 依赖安装失败，请检查上方 npm 输出"
    fi
  fi
}

install_deps "$BACKEND_DIR"  "后端"
install_deps "$FRONTEND_DIR" "前端"

# ============================================================================
# 4. 构建前端
# ============================================================================
step 4 "构建前端"
( cd "$FRONTEND_DIR" && npm run build )
[ -f "$FRONTEND_DIST/index.html" ] || fail "未生成前端产物：$FRONTEND_DIST/index.html"
log "前端构建完成：$FRONTEND_DIST"

# ============================================================================
# 5. 准备后端运行期目录（只改必要的，不动仓库源码属主）
# ============================================================================
step 5 "准备后端运行期目录"

# 后端 dataDir 取自 .env 的 DATA_DIR，相对路径以 Backend/ 为基准（与进程 cwd 一致）
env_data_dir="$(sed -n 's/^[[:space:]]*DATA_DIR[[:space:]]*=[[:space:]]*//p' "$ENV_FILE" 2>/dev/null \
  | tail -n1 | tr -d '\r' | tr -d '"' | tr -d "'" | sed 's/[[:space:]]*$//')"
if [ -z "$env_data_dir" ]; then
  env_data_dir="./data"
fi
case "$env_data_dir" in
  /*) DATA_DIR_ABS="$env_data_dir" ;;
  *)  DATA_DIR_ABS="$BACKEND_DIR/${env_data_dir#./}" ;;
esac

mkdir -p "$DATA_DIR_ABS"
# 仅将数据目录交给运行用户，保证 SQLite 与附件可写。
# 不 chown 整个 Backend/：那会夺走仓库属主，导致 taibai 后续 git pull / 改代码失权。
chown -R "${BACKEND_USER}:${BACKEND_GROUP}" "$DATA_DIR_ABS"
chmod 750 "$DATA_DIR_ABS"
log "数据目录：$DATA_DIR_ABS → ${BACKEND_USER}:${BACKEND_GROUP}"

# .env 只保证运行用户可读，不改变属主，方便你继续用 taibai 编辑
chown "root:${BACKEND_GROUP}" "$ENV_FILE"
chmod 640 "$ENV_FILE"
log "环境文件权限：$ENV_FILE → root:${BACKEND_GROUP} 640"

# ============================================================================
# 6. 部署前端产物
# ============================================================================
step 6 "部署前端产物到 $WEB_ROOT（${WEB_USER}:${WEB_GROUP}）"
mkdir -p "$WEB_ROOT"
# 清空旧产物（含隐藏文件），保留目录本身
find "$WEB_ROOT" -mindepth 1 -delete
cp -R "$FRONTEND_DIST/." "$WEB_ROOT/"
chown -R "${WEB_USER}:${WEB_GROUP}" "$WEB_ROOT"
chmod -R u=rwX,go=rX "$WEB_ROOT"
log "已部署 $FRONTEND_DIST → $WEB_ROOT"

# ============================================================================
# 7. 重启服务
# ============================================================================
step 7 "重启服务 $SERVICE_NAME"

# 若单元文件刚被改过，先让 systemd 重新加载
systemctl daemon-reload

if svc_active; then
  systemctl restart "$SERVICE_NAME"
  log "已重启 $SERVICE_NAME"
else
  systemctl start "$SERVICE_NAME"
  log "已启动 $SERVICE_NAME"
fi

# ============================================================================
# 8. 验证服务
# ============================================================================
step 8 "验证服务状态"

# 单元配置了 Restart=always，崩溃后会不断重启，稍等再判定更可靠
sleep 3

if svc_active; then
  log "$SERVICE_NAME 运行中"
else
  warn "$SERVICE_NAME 未处于运行状态，最近日志如下："
  journalctl -u "$SERVICE_NAME" -n 40 --no-pager >&2 || true
  fail "$SERVICE_NAME 启动失败，请执行：systemctl status $SERVICE_NAME"
fi

echo
log "部署完成："
log "  后端：$BACKEND_DIR（运行用户 ${BACKEND_USER}）"
log "  数据：$DATA_DIR_ABS"
log "  前端：$WEB_ROOT（${WEB_USER}:${WEB_GROUP}）"
log "  服务：$SERVICE_NAME（$(systemctl is-active "$SERVICE_NAME")）"
