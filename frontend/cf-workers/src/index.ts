/**
 * FlowMind API — Cloudflare Workers 版本
 * 框架: Hono (兼容 Workers)
 * 数据库: Cloudflare D1 (SQLite)
 * AI: SiliconFlow
 *
 * 路由:
 *   GET  /                    → 前端 index.html
 *   GET  /dashboard.html      → 前端 dashboard.html
 *   GET  /style.css          → 样式
 *   GET  /assets/*           → 静态资源
 *   Auth:   POST /api/auth/register, /api/auth/login,
 *           POST /api/auth/send-reset-code, POST /api/auth/reset-password
 *   User:   GET  /api/user/credit, GET /api/user/subscription
 *   Rewrite:POST /api/rewrite
 *   Health: GET  /api/health
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { env } from 'hono/cloudflare-workers'

// ── Types ──────────────────────────────────────────────────────────────────

interface Env {
  DATABASE: D1Database
  JWT_SECRET: string
  SILICONFLOW_API_KEY: string
  AI_MODEL?: string
}

type UserPayload = { userId: number; email: string }

// ── Helpers ────────────────────────────────────────────────────────────────

async function makeToken(payload: UserPayload, secret: string): Promise<string> {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '')
  const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 3600
  const body = btoa(JSON.stringify({ ...payload, exp })).replace(/=/g, '')

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(header + '.' + body))
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, '')

  return header + '.' + body + '.' + sigB64
}

async function verifyToken(token: string, secret: string): Promise<UserPayload | null> {
  try {
    const [h, b, s] = token.split('.')
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    )
    const sigBytes = Uint8Array.from(atob(s), c => c.charCodeAt(0))
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(h + '.' + b))
    if (!valid) return null

    const payload = JSON.parse(atob(b))
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return { userId: payload.userId, email: payload.email }
  } catch { return null }
}

async function hashPassword(password: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password))
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function makeOrderNo(): string {
  return 'FM' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6).toUpperCase()
}

// ── Platform Prompts ─────────────────────────────────────────────────────

const PLATFORM_PROMPTS: Record<string, string> = {
  xiaohongshu: `你是一个专业的小红书内容创作者。把给定的原始文章改写成小红书风格的笔记。

要求：
- 加入适量 emoji，每个段落开头用 emoji 引入
- 分成短段落，每段不超过3行
- 结尾加上 3-5 个相关热门话题标签，以 # 开头
- 语气亲切、接地气，像和朋友聊天
- 标题要吸睛，在开头直接说"必看"/"分享"/"干货"
- 总字数控制在 300-800 字

直接返回改写内容，不要加任何前缀说明。`,

  twitter: `You are a professional Twitter/X content creator. Rewrite the given article as a Twitter thread in English.

Requirements:
- Use numbered format: 1/, 2/, 3/ etc.
- Each tweet max 280 characters
- Make the first tweet a strong hook
- Punchy, direct, no fluff
- End with relevant hashtags
- Thread should be 3-5 tweets total
- Preserve the core insight from the original

Return ONLY the thread content, no explanations. Use \\n---\\n to separate tweets.`,

  gongzhonghao: `你是一个专业公众号内容创作者。把给定的原始文章改写成公众号风格长文。

要求：
- 开头要有引导语，吸引读者往下看
- 标题用【】包裹，要有信息量
- 保留文章的深度和完整性
- 段落分明，适当加粗关键句子（用**包裹）
- 不加 emoji，保持专业但有温度
- 字数控制在 800-1500 字

直接返回改写内容，不要加前缀说明。`,

  douyin: `你是一个专业抖音文案创作者。把给定的原始文章改写成抖音风格短视频文案。

要求：
- 开头要有代入感，像和观众聊天，不要太夸张
- 不要用"震惊"、"99%人不知道"、"逆袭"等夸张词汇
- 中间内容要真实自然，有共鸣
- 结尾可以用轻松的方式引导互动
- 语气真实、接地气，不油腻
- 总字数 150-250 字

直接返回改写内容，不要加前缀说明。`,

  weibo: `你是一个专业微博内容创作者。把给定的原始文章改写成微博风格短内容。

要求：
- 开头要有爆点，一句话抓住注意力
- 可以中英混杂
- 适当使用 emoji，但不要过度
- 带上 1-2 个话题标签
- 语气轻松有态度
- 字数 100-300 字

直接返回改写内容，不要加前缀说明。`
}

const PLATFORM_NAMES: Record<string, string> = {
  xiaohongshu: '小红书', twitter: 'Twitter/X', gongzhonghao: '公众号',
  douyin: '抖音', weibo: '微博'
}

const CREDIT_COST = 0.001

// ── AI Rewrite ─────────────────────────────────────────────────────────────

async function rewriteWithSiliconFlow(content: string, platform: string, apiKey: string): Promise<string> {
  const prompt = PLATFORM_PROMPTS[platform]
  if (!prompt) throw new Error(`Unknown platform: ${platform}`)

  const response = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'deepseek-ai/DeepSeek-V3',
      max_tokens: 1024,
      temperature: 0.7,
      messages: [{ role: 'user', content: `${prompt}\n\n原始内容：\n${content}` }]
    })
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`AI error ${response.status}: ${err}`)
  }

  const data = await response.json()
  return data.choices?.[0]?.message?.content || ''
}

// ── Static File Helper ────────────────────────────────────────────────────

const HTML_CACHE = new Map<string, string>()
const CSS_CACHE = new Map<string, string>()

async function serveStatic(path: string, env: Env, contentType: string): Promise<Response> {
  // Try D1 first, then built-in files
  let content: string | null = null

  if (contentType === 'text/html') {
    if (HTML_CACHE.has(path)) {
      return new Response(HTML_CACHE.get(path), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }
      })
    }
    const row = await env.DATABASE.prepare('SELECT content FROM static_files WHERE path = ? AND type = ?')
      .bind(path, 'html').first<{ content: string }>()
    if (row) {
      HTML_CACHE.set(path, row.content)
      return new Response(row.content, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }
      })
    }
  }

  return new Response('Not Found', { status: 404 })
}

// ── App ───────────────────────────────────────────────────────────────────

const app = new Hono<{ Bindings: Env }>()

app.use('/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Content-Length'],
  credentials: true,
  maxAge: 86400,
}))

// ── Static File Routes ────────────────────────────────────────────────────

app.get('/', async (c) => {
  const indexPath = '/index.html'
  const row = await c.env.DATABASE.prepare('SELECT content FROM static_files WHERE path = ? AND type = ?')
    .bind(indexPath, 'html').first<{ content: string }>()
  if (row) return c.html(row.content)
  return c.html('<h1>FlowMind API Running</h1><p>API docs coming soon.</p>')
})

app.get('/dashboard.html', async (c) => {
  const row = await c.env.DATABASE.prepare('SELECT content FROM static_files WHERE path = ? AND type = ?')
    .bind('/dashboard.html', 'html').first<{ content: string }>()
  if (row) return c.html(row.content)
  return c.html('<h1>Dashboard</h1><p>Not deployed yet.</p>')
})

app.get('/favicon.ico', (c) => c.text('', 204))

// ── Auth Routes ───────────────────────────────────────────────────────────

app.post('/api/auth/register', async (c) => {
  const { email, password } = await c.req.json<{ email: string; password: string }>()
  if (!email?.includes('@')) return c.json({ error: 'valid email required' }, 400)
  if (!password || password.length < 6) return c.json({ error: 'password must be at least 6 chars' }, 400)

  const hashed = await hashPassword(password)

  try {
    const result = await c.env.DATABASE.prepare(
      'INSERT INTO users (email, password, free_credit) VALUES (?, ?, ?)'
    ).bind(email, hashed, 1.0).run()

    const token = await makeToken({ userId: result.meta?.last_row_id as number, email }, c.env.JWT_SECRET)
    return c.json({ token, user: { email } })
  } catch (err: any) {
    if (err?.message?.includes('UNIQUE') || err?.code === 'D1_ERROR') {
      return c.json({ error: 'email already registered' }, 409)
    }
    console.error('Register error:', err)
    return c.json({ error: 'database error' }, 500)
  }
})

app.post('/api/auth/login', async (c) => {
  const { email, password } = await c.req.json<{ email: string; password: string }>()
  if (!email || !password) return c.json({ error: 'email and password required' }, 400)

  const hashed = await hashPassword(password)
  const user = await c.env.DATABASE.prepare(
    'SELECT id, email, password, free_credit FROM users WHERE email = ?'
  ).bind(email).first<{ id: number; email: string; password: string; free_credit: number }>()

  if (!user || user.password !== hashed) {
    return c.json({ error: 'invalid email or password' }, 401)
  }

  const token = await makeToken({ userId: user.id, email: user.email }, c.env.JWT_SECRET)
  return c.json({ token, user: { email: user.email } })
})

app.post('/api/auth/send-reset-code', async (c) => {
  const { email } = await c.req.json<{ email: string }>()
  if (!email?.includes('@')) return c.json({ error: 'valid email required' }, 400)

  const code = Math.floor(100000 + Math.random() * 900000).toString()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')

  await c.env.DATABASE.prepare(
    'UPDATE password_reset_codes SET used = 1 WHERE email = ?'
  ).bind(email).run()

  await c.env.DATABASE.prepare(
    'INSERT INTO password_reset_codes (email, code, expires_at) VALUES (?, ?, ?)'
  ).bind(email, code, expiresAt).run()

  // Demo mode: return code in response
  return c.json({ message: 'code sent (demo mode)', code })
})

app.post('/api/auth/reset-password', async (c) => {
  const { email, code, newPassword } = await c.req.json<{ email: string; code: string; newPassword: string }>()
  if (!email || !code || !newPassword) return c.json({ error: 'email, code and newPassword required' }, 400)
  if (newPassword.length < 6) return c.json({ error: 'password must be at least 6 chars' }, 400)

  const record = await c.env.DATABASE.prepare(
    'SELECT id FROM password_reset_codes WHERE email = ? AND code = ? AND used = 0 AND expires_at > ? ORDER BY id DESC LIMIT 1'
  ).bind(email, code, new Date().toISOString().slice(0, 19).replace('T', ' '))
    .first<{ id: number }>()

  if (!record) return c.json({ error: 'invalid or expired code' }, 400)

  const hashed = await hashPassword(newPassword)
  await c.env.DATABASE.prepare('UPDATE users SET password = ? WHERE email = ?').bind(hashed, email).run()
  await c.env.DATABASE.prepare('UPDATE password_reset_codes SET used = 1 WHERE id = ?').bind(record.id).run()

  return c.json({ message: 'password updated' })
})

// ── User Routes ───────────────────────────────────────────────────────────

app.get('/api/user/credit', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  if (!token) return c.json({ error: 'authorization header required' }, 401)

  const payload = await verifyToken(token, c.env.JWT_SECRET)
  if (!payload) return c.json({ error: 'invalid or expired token' }, 401)

  const user = await c.env.DATABASE.prepare('SELECT free_credit FROM users WHERE id = ?')
    .bind(payload.userId).first<{ free_credit: number }>()

  if (!user) return c.json({ error: 'user not found' }, 404)
  return c.json({ credit: user.free_credit })
})

app.get('/api/user/subscription', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  if (!token) return c.json({ error: 'authorization header required' }, 401)

  const payload = await verifyToken(token, c.env.JWT_SECRET)
  if (!payload) return c.json({ error: 'invalid or expired token' }, 401)

  const sub = await c.env.DATABASE.prepare(
    "SELECT plan, status, expires_at FROM subscriptions WHERE user_id = ? AND status = 'active' AND expires_at > ? ORDER BY id DESC LIMIT 1"
  ).bind(payload.userId, new Date().toISOString().slice(0, 19).replace('T', ' '))
    .first<{ plan: string; status: string; expires_at: string }>()

  return c.json({ plan: sub?.plan || null, status: sub?.status, expires_at: sub?.expires_at })
})

// ── Rewrite Route ─────────────────────────────────────────────────────────

app.post('/api/rewrite', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  if (!token) return c.json({ error: 'authorization header required' }, 401)

  const payload = await verifyToken(token, c.env.JWT_SECRET)
  if (!payload) return c.json({ error: 'invalid or expired token' }, 401)

  const { content, platforms } = await c.req.json<{ content: string; platforms: string[] }>()
  if (!content?.trim()) return c.json({ error: 'content is required' }, 400)
  if (!platforms?.length) return c.json({ error: 'platforms must be a non-empty array' }, 400)

  const validPlatforms = platforms.filter(p => PLATFORM_PROMPTS[p])
  if (!validPlatforms.length) return c.json({ error: 'no valid platforms' }, 400)

  const totalCost = validPlatforms.length * CREDIT_COST

  // Check subscription
  const sub = await c.env.DATABASE.prepare(
    "SELECT plan FROM subscriptions WHERE user_id = ? AND status = 'active' AND expires_at > ? LIMIT 1"
  ).bind(payload.userId, new Date().toISOString().slice(0, 19).replace('T', ' '))
    .first<{ plan: string }>()

  const isSubscriber = !!sub

  if (!isSubscriber) {
    const user = await c.env.DATABASE.prepare('SELECT free_credit FROM users WHERE id = ?')
      .bind(payload.userId).first<{ free_credit: number }>()
    const credit = user?.free_credit || 0
    if (credit < totalCost) {
      return c.json({ error: 'insufficient credit', required: totalCost, available: credit }, 402)
    }
    await c.env.DATABASE.prepare('UPDATE users SET free_credit = free_credit - ? WHERE id = ?')
      .bind(totalCost, payload.userId).run()
  }

  const results = await Promise.all(
    validPlatforms.map(async (platform) => {
      try {
        const rewritten = await rewriteWithSiliconFlow(content, platform, c.env.SILICONFLOW_API_KEY)
        await c.env.DATABASE.prepare(
          'INSERT INTO rewrite_logs (user_id, content, platform, result, credit_used) VALUES (?, ?, ?, ?, ?)'
        ).bind(payload.userId, content, platform, rewritten.trim(), CREDIT_COST).run()
        return { platform, platformName: PLATFORM_NAMES[platform], content: rewritten.trim() }
      } catch (err: any) {
        return { platform, platformName: PLATFORM_NAMES[platform], content: `[改写失败: ${err.message}]`, error: true }
      }
    })
  )

  return c.json({ results, creditUsed: isSubscriber ? 0 : totalCost, subscription: isSubscriber })
})

// ── Health ────────────────────────────────────────────────────────────────

app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    provider: 'cloudflare-workers',
    siliconflowConfigured: !!c.env.SILICONFLOW_API_KEY,
  })
})

export default app
