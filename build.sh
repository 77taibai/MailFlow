#!/usr/bin/env bash
#
# MailFlow 一键构建脚本（Linux / macOS）
#
# 1) 检查 Node.js / npm 是否存在、版本是否满足要求
# 2) 构建前端到 ./MailFlowBuild/static（缺少前端运行库时自动 npm install）
# 3) 复制后端文件到 ./MailFlowBuild
# 4) 询问是否创建 .env（复制 .env.example）
# 5) 清理构建临时文件（Frontend/dist）
# 6) 打印产物路径
#
# 用法：
#   ./build.sh              交互式（第 4 步询问是否创建 .env）
#   ./build.sh --create-env 非交互：创建 .env
#   ./build.sh --no-env     非交互：不创建 .env

set -euo pipefail

root="$(cd "$(dirname "$0")" && pwd)"
frontend="$root/Frontend"
backend="$root/Backend"
build="$root/MailFlowBuild"
static="$build/static"
dist="$frontend/dist"

min_major=22
min_minor=5   # Backend/package.json engines.node: >=22.5.0

create_env=""
case "${1:-}" in
  "") ;;
  --create-env) create_env="y" ;;
  --no-env) create_env="n" ;;
  *) echo "[失败] 未知参数: $1（可用：--create-env / --no-env）"; exit 1 ;;
esac

fail() { echo "[失败] $1"; exit 1; }
step() { echo "[$1/6] $2"; }

# ---- 1. 环境检查 ----
step 1 "检查 Node.js 与 npm ..."
command -v node >/dev/null 2>&1 || fail "未找到 Node.js，本项目要求 >= ${min_major}.${min_minor}.0，请自行安装：https://nodejs.org"
command -v npm >/dev/null 2>&1 || fail "未找到 npm（通常随 Node.js 一起安装），请自行安装：https://nodejs.org"

node_raw="$(node -v 2>/dev/null || true)"
[ -n "$node_raw" ] || fail "无法获取 Node.js 版本"
node_ver="${node_raw#v}"
node_ver="${node_ver%%-*}"
major="${node_ver%%.*}"
rest="${node_ver#*.}"
minor="${rest%%.*}"
major="${major:-0}"
minor="${minor:-0}"
case "$major$minor" in
  *[!0-9]*) fail "无法解析 Node.js 版本：$node_raw" ;;
esac
if [ "$major" -lt "$min_major" ] || { [ "$major" -eq "$min_major" ] && [ "$minor" -lt "$min_minor" ]; }; then
  fail "Node.js 版本过低：$node_raw（要求 >= ${min_major}.${min_minor}.0），请自行升级：https://nodejs.org"
fi

npm_raw="$(npm -v 2>/dev/null || true)"
[ -n "$npm_raw" ] || fail "npm 无法运行，请重新安装 Node.js：https://nodejs.org"
echo "       Node.js $node_raw，npm $npm_raw"

# ---- 2. 构建前端 ----
step 2 "构建前端 ..."
[ -f "$frontend/package.json" ] || fail "未找到 Frontend/package.json"

# 运行库检查：node_modules 缺少 vite 说明依赖未安装，先安装
if [ ! -d "$frontend/node_modules/vite" ]; then
  echo "       未检测到前端运行库，执行 npm install ..."
  if ! (cd "$frontend" && npm install); then
    fail "前端运行库安装失败，请检查上方 npm install 输出"
  fi
  [ -d "$frontend/node_modules/vite" ] || fail "前端运行库安装后仍未找到 node_modules/vite，请检查 npm install 输出"
fi

if ! (cd "$frontend" && npm run build); then
  fail "前端构建失败，请检查上方 vite build 输出"
fi
[ -f "$dist/index.html" ] || fail "未生成 Frontend/dist/index.html"

# ---- 3. 组装 MailFlowBuild ----
step 3 "组装 $build ..."
[ -d "$backend" ] || fail "未找到 Backend 目录"
mkdir -p "$build"

# 前端产物：清空 static 后复制
rm -rf "$static"
mkdir -p "$static"
cp -R "$dist/." "$static/"

# 后端文件：跳过 node_modules / data / .env / 日志 / 状态文件（已存在的 .env 保留）
(
  cd "$backend"
  tar -cf - \
    --exclude='./node_modules' --exclude='node_modules' \
    --exclude='./data' --exclude='data' \
    --exclude='./.env' \
    --exclude='./*.log' \
    --exclude='./.agent-server.json' \
    .
) | (cd "$build" && tar -xf -)

# ---- 4. 询问是否创建 .env ----
step 4 "检查 .env ..."
env_file="$build/.env"
example_file="$build/.env.example"
if [ -f "$env_file" ]; then
  echo "       已存在 .env，跳过"
elif [ ! -f "$example_file" ]; then
  echo "       未找到 .env.example，跳过"
else
  answer="$create_env"
  if [ -z "$answer" ]; then
    if [ -t 0 ]; then
      printf '       是否创建 .env（复制 .env.example）？[y/N] '
      read -r answer || answer=""
    else
      answer=""
      echo "       非交互环境且未指定参数，跳过创建"
    fi
  fi
  case "$answer" in
    y|Y|yes|YES|Yes)
      cp "$example_file" "$env_file"
      echo "       已创建 MailFlowBuild/.env，请修改 APP_SECRET 与 AUTH_PASSWORD"
      ;;
    *)
      echo "       未创建 .env"
      ;;
  esac
fi

# ---- 5. 清理构建临时文件 ----
step 5 "清理构建临时文件 ..."
if [ -d "$dist" ]; then
  rm -rf "$dist"
  echo "       已删除 Frontend/dist"
else
  echo "       无临时文件"
fi

# ---- 6. 完成 ----
step 6 "构建完成"
echo "产物目录: $build"
echo "前端资源: $static"
echo "运行方式: cd MailFlowBuild && npm install && npm start"
