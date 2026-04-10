# FlowMind 部署到 Cloudflare（Workers + D1）

## 架构

```
用户浏览器
    │
    ├── GET /              → Workers (serve index.html)
    ├── GET /dashboard.html → Workers (serve dashboard.html)
    └── POST /api/*       → Workers (Hono API + D1)
                                │
                                ├── D1 (SQLite) — 用户/积分/日志
                                └── SiliconFlow API — AI 改写
```

## 前置准备

1. 注册 Cloudflare 账号：https://dash.cloudflare.com
2. 安装 Wrangler CLI：
   ```bash
   npm install -g wrangler
   wrangler login  # 用浏览器授权
   ```

## 快速部署

```bash
cd cf-workers

# 1. 初始化项目
npm install

# 2. 创建 D1 数据库（本地测试用）
wrangler d1 create flowmind-db --local
# 将返回的 database_id 填入 wrangler.toml

# 3. 初始化本地 D1
wrangler d1 execute flowmind-db --local --file=./schema.sql

# 4. 配置 Secrets（API Key）
wrangler secret put SILICONFLOW_API_KEY
# 输入你的 SiliconFlow API Key

# 5. 设置 JWT Secret
wrangler secret put JWT_SECRET
# 输入一个随机字符串，或者运行: openssl rand -base64 32 | tr -d '/+=' | head -c 32

# 6. 本地测试
wrangler dev --port 8787
# 访问 http://localhost:8787

# 7. 生产部署
wrangler deploy
```

## D1 数据库（远程）

```bash
# 创建远程 D1
wrangler d1 create flowmind-db

# 将返回的 database_id 填入 wrangler.toml 的 database_id 字段

# 执行 schema
wrangler d1 execute flowmind-db --remote --file=./schema.sql

# 查看数据
wrangler d1 exec flowmind-db --remote --command="SELECT * FROM users"
```

## 更新前端 API 地址

Workers 部署后会得到一个 `.workers.dev` 域名。前端需要更新 API 地址：

**方法一：修改代码中的 API_BASE（不推荐，改动大）**

**方法二：Workers 支持 API 代理（推荐）**
Workers 已配置为同时服务前端静态文件，无需改动前端代码。

## 绑定自定义域名

```bash
# Workers
wrangler routes update --zone=你的域名 --route=api.你的域名/*

# 或者在 Cloudflare Dashboard → Workers & Pages → 你的Worker → 触发器 → 自定义域
```

## 环境变量

| 变量 | 说明 | 是否必须 |
|------|------|---------|
| SILICONFLOW_API_KEY | 硅基流动 API Key | ✅ |
| JWT_SECRET | JWT 签名密钥（至少32字符） | ✅ |
| AI_MODEL | AI 模型，默认 `deepseek-ai/DeepSeek-V3` | ❌ |

## 部署检查

```bash
# 查看实时日志
wrangler tail

# 健康检查
curl https://你的域名/api/health
# 返回: {"status":"ok","provider":"cloudflare-workers","siliconflowConfigured":true}
```

## 常见问题

**Q: D1 免费额度用完怎么办？**
A: D1 Starter 免费 5GB，超出后自动计费。或迁移到 PlanetScale/Railway。

**Q: SiliconFlow 在 CF Workers 里有访问限制吗？**
A: Workers 出站请求共享 IP 池，有频率限制。高并发场景建议加个 CF Cache。

**Q: Workers 日用量超免费额度？**
A: Workers 免费每天 100,000 请求，超出 $5/百万请求。个人项目够用。

## 本地前后端联调

```bash
# 终端1: 启动 Workers（API）
cd cf-workers && wrangler dev --port 8787

# 终端2: 启动前端（静态）
cd .. && python3 -m http.server 4000
```

前端请求 `http://localhost:8787/api/...`，Workers 连接本地 D1。

## 目录结构

```
flowmind-website/
├── cf-workers/           # Cloudflare Workers 项目
│   ├── src/
│   │   └── index.ts     # Workers 主代码（Hono API）
│   ├── public/          # 前端静态文件（部署时复制到这里）
│   ├── schema.sql       # D1 数据库 schema
│   ├── wrangler.toml    # Workers 配置
│   ├── package.json
│   └── deploy.sh        # 部署脚本
├── index.html           # 落地页
├── dashboard.html       # Dashboard
├── style.css
└── assets/
```
