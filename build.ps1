<#
  MailFlow 一键构建脚本（Windows PowerShell 5.1+）

  1) 检查 Node.js / npm 是否存在、版本是否满足要求
  2) 构建前端到 .\MailFlowBuild\static（缺少前端运行库时自动 npm install）
  3) 复制后端文件到 .\MailFlowBuild
  4) 询问是否创建 .env（复制 .env.example）
  5) 清理构建临时文件（Frontend\dist）
  6) 打印产物路径

  用法：
    .\build.ps1              交互式（第 4 步询问是否创建 .env）
    .\build.ps1 -CreateEnv   非交互：创建 .env
    .\build.ps1 -NoEnv       非交互：不创建 .env
#>
param(
  [switch]$CreateEnv,
  [switch]$NoEnv
)

$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
if (-not $root) { $root = (Get-Location).Path }

$frontendDir = Join-Path $root 'Frontend'
$backendDir = Join-Path $root 'Backend'
$buildDir = Join-Path $root 'MailFlowBuild'
$staticDir = Join-Path $buildDir 'static'
$distDir = Join-Path $frontendDir 'dist'

$minNode = [version]'22.5.0'   # Backend/package.json engines.node

function Step($n, $msg) { Write-Host "[$n/6] $msg" }
function Fail($msg) { Write-Host "[失败] $msg"; exit 1 }

# ---- 1. 环境检查 ----
Step 1 '检查 Node.js 与 npm ...'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail "未找到 Node.js，本项目要求 >= $minNode，请自行安装：https://nodejs.org"
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Fail '未找到 npm（通常随 Node.js 一起安装），请自行安装：https://nodejs.org'
}
try {
  $nodeRaw = (& node -v | Out-String).Trim()
} catch {
  Fail "Node.js 无法运行：$($_.Exception.Message)"
}
if (-not $nodeRaw) { Fail '无法获取 Node.js 版本' }
$nodeText = $nodeRaw.TrimStart('v')
$dash = $nodeText.IndexOf('-')
if ($dash -ge 0) { $nodeText = $nodeText.Substring(0, $dash) }
try {
  $nodeVer = [version]$nodeText
} catch {
  Fail "无法解析 Node.js 版本：$nodeRaw"
}
if ($nodeVer -lt $minNode) {
  Fail "Node.js 版本过低：$nodeRaw（要求 >= $minNode），请自行升级：https://nodejs.org"
}
try {
  $npmRaw = (& npm -v | Out-String).Trim()
} catch {
  Fail "npm 无法运行：$($_.Exception.Message)"
}
if (-not $npmRaw) { Fail 'npm 无法运行，请重新安装 Node.js：https://nodejs.org' }
Write-Host "       Node.js $nodeRaw，npm $npmRaw"

# ---- 2. 构建前端 ----
Step 2 '构建前端 ...'
if (-not (Test-Path (Join-Path $frontendDir 'package.json'))) { Fail '未找到 Frontend\package.json' }
Push-Location $frontendDir
try {
  # 运行库检查：node_modules 缺少 vite 说明依赖未安装，先安装
  if (-not (Test-Path (Join-Path (Join-Path $frontendDir 'node_modules') 'vite'))) {
    Write-Host '       未检测到前端运行库，执行 npm install ...'
    & npm install
    if ($LASTEXITCODE -ne 0) { Fail "前端运行库安装失败，npm install 退出码 $LASTEXITCODE" }
    if (-not (Test-Path (Join-Path (Join-Path $frontendDir 'node_modules') 'vite'))) {
      Fail '前端运行库安装后仍未找到 node_modules\vite，请检查 npm install 输出'
    }
  }
  & npm run build
  if ($LASTEXITCODE -ne 0) { Fail "前端构建失败，npm run build 退出码 $LASTEXITCODE" }
} catch {
  Fail "前端构建失败：$($_.Exception.Message)"
} finally {
  Pop-Location
}
if (-not (Test-Path (Join-Path $distDir 'index.html'))) { Fail '未生成 Frontend\dist\index.html' }

# ---- 3. 组装 MailFlowBuild ----
Step 3 "组装 $buildDir ..."
if (-not (Test-Path $backendDir)) { Fail '未找到 Backend 目录' }
if (-not (Test-Path $buildDir)) { New-Item -ItemType Directory -Path $buildDir | Out-Null }

# 前端产物：清空 static 后复制
if (Test-Path $staticDir) { Remove-Item -LiteralPath $staticDir -Recurse -Force }
New-Item -ItemType Directory -Path $staticDir | Out-Null
Copy-Item -Path (Join-Path $distDir '*') -Destination $staticDir -Recurse -Force

# 后端文件：跳过 node_modules / data / .env / 日志 / 状态文件（已存在的 .env 保留）
$excludeNames = @('node_modules', 'data', '.env', '.agent-server.json')
Get-ChildItem -Path $backendDir -Force | Where-Object {
  ($excludeNames -notcontains $_.Name) -and ($_.Extension -ne '.log')
} | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $buildDir -Recurse -Force
}

# ---- 4. 询问是否创建 .env ----
Step 4 '检查 .env ...'
$envFile = Join-Path $buildDir '.env'
$exampleFile = Join-Path $buildDir '.env.example'
if (Test-Path $envFile) {
  Write-Host '       已存在 .env，跳过'
} elseif (-not (Test-Path $exampleFile)) {
  Write-Host '       未找到 .env.example，跳过'
} else {
  $answer = ''
  if ($CreateEnv) {
    $answer = 'y'
  } elseif ($NoEnv) {
    $answer = 'n'
  } else {
    $answer = Read-Host '       是否创建 .env（复制 .env.example）？[y/N]'
  }
  if ($answer -match '^\s*y(es)?\s*$') {
    Copy-Item -LiteralPath $exampleFile -Destination $envFile
    Write-Host '       已创建 MailFlowBuild\.env，请修改 APP_SECRET 与 AUTH_PASSWORD'
  } else {
    Write-Host '       未创建 .env'
  }
}

# ---- 5. 清理构建临时文件 ----
Step 5 '清理构建临时文件 ...'
if (Test-Path $distDir) {
  Remove-Item -LiteralPath $distDir -Recurse -Force
  Write-Host '       已删除 Frontend\dist'
} else {
  Write-Host '       无临时文件'
}

# ---- 6. 完成 ----
Step 6 '构建完成'
Write-Host "产物目录: $buildDir"
Write-Host "前端资源: $staticDir"
Write-Host '运行方式: cd MailFlowBuild; npm install; npm start'
