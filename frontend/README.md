# OnePost — 写一次，AI 自动分发到全平台

![Status](https://img.shields.io/badge/status-Beta-yellow)
![Node](https://img.shields.io/badge/node-%3E%3D18-blue)

---

## 🚀 快速启动

### 1. 前端（落地页）

```bash
cd /Users/ling/flowmind-website
./start.sh start
# 访问 http://localhost:4000
```

### 2. 后端 API（可选，需要真实 AI 能力）

```bash
cd backend

# 安装依赖
npm install

# 配置 API Key（需要 SiliconFlow API Key）
export SILICONFLOW_API_KEY=your_key

# 启动
node server.js
# 运行在 http://localhost:3001
```

> 不启动后端时，Demo 区会显示连接错误。落地页其他功能（通知、定价切换等）正常。

---

## 📁 项目结构

```
flowmind-website/
├── index.html          # 落地页
├── style.css           # 样式
├── script.js           # 交互逻辑
├── start.sh            # 前端启动脚本
├── backend/
│   ├── server.js       # Express API 服务
│   ├── package.json
│   └── n8n-workflow.json  # n8n workflow 备份
└── README.md
```

---

## 🔌 API 接口

### POST /api/rewrite

改写内容到指定平台。

**请求**
```json
{
  "content": "原始文章内容...",
  "platforms": ["xiaohongshu", "twitter", "gongzhonghao"]
}
```

**响应**
```json
{
  "results": [
    { "platform": "xiaohongshu", "platformName": "小红书", "content": "改写后的内容" },
    { "platform": "twitter", "platformName": "Twitter/X", "content": "改写后的内容" },
    { "platform": "gongzhonghao", "platformName": "公众号", "content": "改写后的内容" }
  ]
}
```

### GET /api/health

健康检查。

---

## 🔧 配置

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `SILICONFLOW_API_KEY` | SiliconFlow API Key（必填） | - |
| `PORT` | API 服务端口 | `3001` |

---

## 📍 下一步

- [ ] 验证需求：发 Twitter/即刻 验证目标用户痛点
- [ ] 接入真实支付（Stripe）
- [ ] 添加用户系统（登录/注册）
- [ ] 接入 n8n 自动化工作流（备份在 `backend/n8n-workflow.json`）
- [ ] 部署到生产环境

---

## 验证需求 — 推文草稿

已生成，见 `/Users/ling/onepost_tweet_drafts.md`
