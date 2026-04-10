# ⚠️ 暂不可用

Cloudflare Workers 运行环境无法直接连接外部 MySQL（Railway MySQL）。

如需使用 Cloudflare 部署，请选择以下方案之一：

1. **Cloudflare Tunnel** — 通过隧道连接 Railway MySQL（需额外配置）
2. **换用 Cloudflare D1** — 改用 D1 数据库（SQLite），需重写部分查询逻辑
3. **换用支持 TCP 直连的 PaaS** — 如 Railway, Render, Fly.io

---

如需继续开发 Cloudflare Workers 版本，请联系开发者。
