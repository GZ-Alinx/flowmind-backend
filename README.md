# FlowMind — AI 内容分发工具

![Status](https://img.shields.io/badge/status-Beta-yellow)
![Node](https://img.shields.io/badge/node-%3E%3D18-blue)

写一次，AI 自动改写分发到小红书/抖音/Twitter/公众号

---

## 🚀 本地开发

```bash
cd /Users/ling/flowmind-website

# 启动前端 + 后端
./start.sh start

# 停止
./start.sh stop

# 查看状态
./start.sh status
```

访问 http://localhost:4000

---

## 📁 项目结构

```
flowmind-website/
├── frontend/              # 落地页 + 改写工具
│   ├── index.html         # 落地页（登录/注册）
│   ├── dashboard.html     # 改写工具
│   ├── start.sh           # 前后端启动脚本
│   └── assets/
└── backend/              # Express API
    ├── server.js          # API 服务
    ├── package.json
    └── cf-workers/       # Cloudflare Workers 部署（未配置）
```

---

## 🔧 环境变量（backend/.env）

```env
SILICONFLOW_API_KEY=your_siliconflow_api_key
JWT_SECRET=随机字符串
PORT=3001

# MySQL（可选，内存模式可跑 Demo）
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=flowmind123
MYSQL_DATABASE=flowmind

# 虎皮椒支付（可选）
HUPIJIAO_APP_ID=your_app_id
HUPIJIAO_APP_KEY=your_app_key
```

---

## 🔌 主要 API

| 接口 | 说明 |
|------|------|
| `POST /api/rewrite` | 改写内容到多平台 |
| `POST /api/auth/register` | 注册 |
| `POST /api/auth/login` | 登录 |
| `GET /api/health` | 健康检查 |

---

## 📍 下一步

- [ ] 部署到 Railway + Cloudflare Pages
- [ ] 接入真实支付（虎皮椒）
- [ ] 验证需求（发 Twitter/即刻 试探市场）

---

## 🌐 线上地址（待部署）

- 前端: (未部署)
- API: (未部署)
