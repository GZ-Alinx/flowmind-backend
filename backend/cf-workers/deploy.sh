#!/bin/bash
# FlowMind CF Workers 部署脚本
# 用法: ./deploy.sh [dev|prod]

set -e

MODE=${1:-dev}
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "📦 FlowMind CF Workers 部署 ($MODE)"

# 1. 安装依赖
if [ ! -d "node_modules" ]; then
  echo "📥 安装依赖..."
  npm install
fi

# 2. Cloudflare 登录检查
echo "🔑 检查 Cloudflare 登录状态..."
npx wrangler whoami 2>/dev/null || { echo "❌ 请先运行: npx wrangler login"; exit 1; }

# 3. 初始化 D1 数据库
echo "🗄️  初始化 D1 数据库..."
read -p "数据库名 (flowmind-db): " DB_NAME
DB_NAME=${DB_NAME:-flowmind-db}

if [ "$MODE" = "dev" ]; then
  # Local D1 for dev
  npx wrangler d1 create $DB_NAME --local 2>/dev/null || true
  npx wrangler d1 execute $DB_NAME --local --file=./schema.sql
  echo "✅ Local D1 初始化完成"
else
  # Remote D1 for prod
  echo "🌐 创建/更新远程 D1 数据库..."
  npx wrangler d1 create $DB_NAME 2>/dev/null || true
  
  # 获取 database_id 并更新 wrangler.toml
  DB_ID=$(npx wrangler d1 list 2>/dev/null | grep $DB_NAME | awk '{print $3}')
  if [ -n "$DB_ID" ]; then
    sed -i.bak "s/database_id = \".*\"/database_id = \"$DB_ID\"/" wrangler.toml
    echo "✅ wrangler.toml 已更新 (database_id: $DB_ID)"
  fi

  # 执行 schema
  npx wrangler d1 execute $DB_NAME --remote --file=./schema.sql
  echo "✅ 远程 D1 schema 部署完成"
fi

# 4. 设置 Secrets
echo "🔐 配置 Secrets..."
read -p "SILICONFLOW_API_KEY: " SF_KEY
[ -n "$SF_KEY" ] && echo "$SF_KEY" | npx wrangler secret put SILICONFLOW_API_KEY

read -p "JWT_SECRET (直接回车生成随机): " JWT_SEC
if [ -z "$JWT_SEC" ]; then
  JWT_SEC=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)
  echo "Generated: $JWT_SEC"
fi
echo "$JWT_SEC" | npx wrangler secret put JWT_SECRET

# 5. 部署
echo "🚀 开始部署..."
if [ "$MODE" = "dev" ]; then
  npx wrangler dev --port 8787
else
  npx wrangler deploy --env production
  echo "✅ 生产部署完成!"
  echo "🌐 API: https://flowmind-api.<your-subdomain>.workers.dev"
fi

echo ""
echo "📝 部署后检查:"
echo "   curl https://flowmind-api.<your-subdomain>.workers.dev/api/health"
