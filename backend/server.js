/**
 * FlowMind Backend - Express + SiliconFlow + MySQL + 虎皮椒支付
 *
 * Routes:
 *   Auth:        POST /api/auth/register, /api/auth/login, GET /api/user/credit
 *   Rewrite:     POST /api/rewrite
 *   Payment:    POST /api/pay/create,   GET  /api/pay/status, POST /api/pay/notify
 *   Health:      GET  /api/health
 *
 * MySQL tables: users, rewrite_logs, orders, subscriptions
 *
 * Environment:
 *   SILICONFLOW_API_KEY   SiliconFlow API Key (required)
 *   HUPIJIAO_APP_ID       虎皮椒 App ID (optional — demo mode if not set)
 *   HUPIJIAO_APP_KEY      虎皮椒 App Key (optional)
 *   MYSQL_HOST/PORT/USER/PASSWORD/DATABASE
 *   JWT_SECRET            default "flowmind_secret_key"
 *   PORT                 default 3001
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const crypto = require('crypto');

// ── Config ─────────────────────────────────────────────────────────────
const PORT       = process.env.PORT || 3001;
const SF_API_KEY = process.env.SILICONFLOW_API_KEY;
const SF_BASE    = 'https://api.siliconflow.cn/v1';
const MODEL      = 'deepseek-ai/DeepSeek-V3';
const JWT_SECRET = process.env.JWT_SECRET || 'flowmind_secret_key';
const JWT_TTL    = 7 * 24 * 3600; // 7 days

// 虎皮椒支付
const HUPIJIAO_APP_ID  = process.env.HUPIJIAO_APP_ID  || '';
const HUPIJIAO_APP_KEY = process.env.HUPIJIAO_APP_KEY || '';
const HUPIJIAO_URL     = 'https://api.hupijiao.com';
const IS_DEMO          = !HUPIJIAO_APP_ID; // 无配置则 Demo 模式

// MySQL
const MYSQL = {
  host:     process.env.MYSQL_HOST     || 'localhost',
  port:     parseInt(process.env.MYSQL_PORT) || 3306,
  user:     process.env.MYSQL_USER     || 'root',
  password: process.env.MYSQL_PASSWORD || 'flowmind123',
  database: process.env.MYSQL_DATABASE || 'flowmind',
};

// ── App ─────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// ── MySQL Pool ──────────────────────────────────────────────────────────
let pool;
try {
  pool = mysql.createPool({
    host:     MYSQL.host,
    port:     MYSQL.port,
    user:     MYSQL.user,
    password: MYSQL.password,
    database: MYSQL.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });
  console.log('✅ MySQL pool created');
} catch(e) {
  console.error('❌ MySQL pool failed:', e.message);
}

// ── Auto-init tables ────────────────────────────────────────────────────
async function initTables() {
  if (!pool) return;
  
  // 先不带 database 连接，建库
  const tmpPool = mysql.createPool({
    host:     MYSQL.host,
    port:     MYSQL.port,
    user:     MYSQL.user,
    password: MYSQL.password,
    connectTimeout: 15000,
    waitForConnections: true,
    connectionLimit: 2,
  });
  try {
    const tmpConn = await tmpPool.getConnection();
    await tmpConn.query(`CREATE DATABASE IF NOT EXISTS flowmind`);
    console.log('✅ flowmind 数据库创建/确认成功');
    tmpConn.release();
    await tmpPool.end();
  } catch(e) {
    console.error('❌ 建库失败:', e.message);
    try { await tmpPool.end(); } catch {}
    return;
  }

  // 正式建表
  const conn = await pool.getConnection();
  try {
    await conn.query(`USE flowmind`);
    await conn.query(`CREATE TABLE IF NOT EXISTS users (
      id INT PRIMARY KEY AUTO_INCREMENT,
      email VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      free_credit REAL DEFAULT 1.0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS rewrite_logs (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      content TEXT,
      platform VARCHAR(50),
      result TEXT,
      credit_used REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS orders (
      id INT PRIMARY KEY AUTO_INCREMENT,
      order_no VARCHAR(100) UNIQUE NOT NULL,
      user_id INT NOT NULL,
      product_type VARCHAR(50),
      amount REAL,
      pay_method VARCHAR(20),
      status VARCHAR(20) DEFAULT 'pending',
      paid_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS subscriptions (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      plan VARCHAR(50),
      status VARCHAR(20) DEFAULT 'active',
      expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await conn.query(`CREATE TABLE IF NOT EXISTS password_reset_codes (
      id INT PRIMARY KEY AUTO_INCREMENT,
      email VARCHAR(255) NOT NULL,
      code VARCHAR(10) NOT NULL,
      expires_at DATETIME,
      used INT DEFAULT 0
    )`);
    console.log('✅ 数据库表初始化完成');
  } catch(e) {
    console.error('❌ 建表失败:', e.message);
  } finally {
    conn.release();
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────
function signJWT(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body   = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now()/1000) + JWT_TTL })).toString('base64url');
  const sig    = crypto.createHmac('sha256', JWT_SECRET).update(header + '.' + body).digest('base64url');
  return header + '.' + body + '.' + sig;
}

function verifyJWT(token) {
  try {
    const [h, b, s] = token.split('.');
    if (crypto.createHmac('sha256', JWT_SECRET).update(h + '.' + b).digest('base64url') !== s) return null;
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString());
    if (payload.exp < Math.floor(Date.now()/1000)) return null;
    return payload;
  } catch { return null; }
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'authorization header required' });
  const payload = verifyJWT(token);
  if (!payload) return res.status(401).json({ error: 'invalid or expired token' });
  req.user = payload;
  next();
}

function simpleHash(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function makeOrderNo() {
  return 'FM' + Date.now() + crypto.randomBytes(4).toString('hex').toUpperCase();
}

// ── Auth Routes ─────────────────────────────────────────────────────────

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'valid email required' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'password must be at least 6 chars' });

  try {
    const hashed = simpleHash(password);
    const [result] = await pool.execute(
      'INSERT INTO users (email, password, free_credit) VALUES (?, ?, ?)',
      [email, hashed, 1.0]
    );
    const token = signJWT({ userId: result.insertId, email });
    res.json({ token, user: { email } });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'email already registered' });
    console.error('Register error:', err);
    res.status(500).json({ error: 'database error' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  try {
    const [rows] = await pool.execute('SELECT id, email, password, free_credit FROM users WHERE email = ?', [email]);
    const user = rows[0];
    if (!user || user.password !== simpleHash(password)) {
      return res.status(401).json({ error: 'invalid email or password' });
    }
    const token = signJWT({ userId: user.id, email: user.email });
    res.json({ token, user: { email: user.email } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'database error' });
  }
});

// GET /api/user/credit
app.get('/api/user/credit', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT free_credit FROM users WHERE id = ?', [req.user.userId]);
    if (!rows[0]) return res.status(404).json({ error: 'user not found' });
    res.json({ credit: parseFloat(rows[0].free_credit) });
  } catch (err) {
    console.error('Credit error:', err);
    res.status(500).json({ error: 'database error' });
  }
});

// ── Forgot / Reset Password ─────────────────────────────────────────────
const nodemailer = require('nodemailer');

function makeTransporter() {
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });
  }
  return null;
}

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit
}

// POST /api/auth/send-reset-code
app.post('/api/auth/send-reset-code', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'valid email required' });

  try {
    // Check user exists
    const [users] = await pool.execute('SELECT id FROM users WHERE email = ?', [email]);
    if (users.length === 0) {
      // 安全：不暴露用户是否存在，统一返回成功
      return res.json({ message: 'if user exists, code sent' });
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' '); // 10 min

    // Invalidate old codes for this email
    await pool.execute('UPDATE password_reset_codes SET used = 1 WHERE email = ?', [email]);

    // Save new code
    await pool.execute(
      'INSERT INTO password_reset_codes (email, code, expires_at) VALUES (?, ?, ?)',
      [email, code, expiresAt]
    );

    // Send email if SMTP configured
    const transporter = makeTransporter();
    if (transporter) {
      await transporter.sendMail({
        from: `"FlowMind" <${process.env.SMTP_USER}>`,
        to: email,
        subject: '【FlowMind】你的密码重置验证码',
        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;border-radius:12px;border:1px solid #e5e7eb;">
          <h2 style="color:#6366f1;margin-bottom:24px;">FlowMind 密码重置</h2>
          <p style="font-size:15px;color:#374151;margin-bottom:16px;">你好，</p>
          <p style="font-size:15px;color:#374151;margin-bottom:24px;">你请求重置密码，请在 <strong>10 分钟内</strong>完成验证。</p>
          <div style="background:#f5f3ff;border-radius:8px;padding:20px 24px;text-align:center;margin-bottom:24px;">
            <div style="font-size:13px;color:#6b7280;margin-bottom:8px;">验证码</div>
            <div style="font-size:36px;font-weight:800;color:#6366f1;letter-spacing:8px;">${code}</div>
          </div>
          <p style="font-size:13px;color:#9ca3af;">如果你没有请求重置密码，请忽略此邮件。</p>
        </div>`,
      });
      res.json({ message: 'code sent' });
    } else {
      // Demo mode: return code in response (dev only)
      res.json({ message: 'code sent (demo mode)', code });
    }
  } catch (err) {
    console.error('Send reset code error:', err);
    res.status(500).json({ error: 'server error' });
  }
});

// POST /api/auth/reset-password
app.post('/api/auth/reset-password', async (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword) return res.status(400).json({ error: 'email, code and newPassword required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'password must be at least 6 chars' });

  try {
    // Find valid unused code
    const [rows] = await pool.execute(
      'SELECT id FROM password_reset_codes WHERE email = ? AND code = ? AND used = 0 AND expires_at > NOW() ORDER BY id DESC LIMIT 1',
      [email, code]
    );
    if (rows.length === 0) {
      return res.status(400).json({ error: 'invalid or expired code' });
    }

    const hashed = simpleHash(newPassword);
    await pool.execute('UPDATE users SET password = ? WHERE email = ?', [hashed, email]);
    await pool.execute('UPDATE password_reset_codes SET used = 1 WHERE email = ? AND code = ?', [email, code]);

    res.json({ message: 'password updated' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'database error' });
  }
});

// GET /api/user/subscription
app.get('/api/user/subscription', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT plan, status, expires_at FROM subscriptions WHERE user_id = ? AND status = ? ORDER BY id DESC LIMIT 1',
      [req.user.userId, 'active']
    );
    if (!rows[0]) return res.json({ plan: null });
    res.json({ plan: rows[0].plan, status: rows[0].status, expires_at: rows[0].expires_at });
  } catch (err) {
    res.status(500).json({ error: 'database error' });
  }
});

// ── Rewrite Route ───────────────────────────────────────────────────────

const PLATFORM_PROMPTS = {
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
};

const PLATFORM_NAMES = {
  xiaohongshu: '小红书',
  twitter: 'Twitter/X',
  gongzhonghao: '公众号',
  douyin: '抖音',
  weibo: '微博'
};

// Credit cost per platform per rewrite
const CREDIT_COST = 0.001;

async function rewriteWithSiliconFlow(content, platform) {
  if (!SF_API_KEY) throw new Error('SILICONFLOW_API_KEY not configured');
  const prompt = PLATFORM_PROMPTS[platform];
  if (!prompt) throw new Error(`Unknown platform: ${platform}`);

  const response = await fetch(`${SF_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SF_API_KEY}`
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      temperature: 0.7,
      messages: [{ role: 'user', content: `${prompt}\n\n原始内容：\n${content}` }]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`SiliconFlow API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const choice = data.choices && data.choices[0];
  if (!choice || !choice.message) throw new Error(`Unexpected response: ${JSON.stringify(data)}`);
  return choice.message.content || '';
}

// POST /api/rewrite
app.post('/api/rewrite', requireAuth, async (req, res) => {
  const { content, platforms } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'content is required' });
  if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
    return res.status(400).json({ error: 'platforms must be a non-empty array' });
  }

  const validPlatforms = platforms.filter(p => PLATFORM_PROMPTS[p]);
  if (validPlatforms.length === 0) return res.status(400).json({ error: 'no valid platforms provided' });

  const totalCost = validPlatforms.length * CREDIT_COST;

  // Check subscription — subscribers have unlimited access
  let isSubscriber = false;
  try {
    const [subs] = await pool.execute(
      "SELECT plan, expires_at FROM subscriptions WHERE user_id = ? AND status = 'active' AND expires_at > NOW() LIMIT 1",
      [req.user.userId]
    );
    isSubscriber = subs.length > 0;
  } catch {}

  if (!isSubscriber) {
    // Check credit
    const [rows] = await pool.execute('SELECT free_credit FROM users WHERE id = ?', [req.user.userId]);
    const credit = parseFloat(rows[0]?.free_credit || 0);
    if (credit < totalCost) {
      return res.status(402).json({ error: 'insufficient credit', required: totalCost, available: credit });
    }
    // Deduct
    await pool.execute('UPDATE users SET free_credit = free_credit - ? WHERE id = ?', [totalCost, req.user.userId]);
  }

  try {
    const results = await Promise.all(
      validPlatforms.map(async (platform) => {
        try {
          const rewritten = await rewriteWithSiliconFlow(content, platform);
          return { platform, platformName: PLATFORM_NAMES[platform], content: rewritten.trim() };
        } catch (err) {
          return { platform, platformName: PLATFORM_NAMES[platform], content: `[改写失败: ${err.message}]`, error: true };
        }
      })
    );

    // Log
    for (const r of results) {
      await pool.execute(
        'INSERT INTO rewrite_logs (user_id, content, platform, result, credit_used) VALUES (?, ?, ?, ?, ?)',
        [req.user.userId, content, r.platform, r.content, CREDIT_COST]
      );
    }

    res.json({ results, creditUsed: isSubscriber ? 0 : totalCost, subscription: isSubscriber });
  } catch (err) {
    console.error('Rewrite error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Payment Routes ──────────────────────────────────────────────────────

// Credit packge definitions
const CREDIT_PACKAGES = {
  10:  100,  // ¥10 → 100 credits
  49:  500,  // ¥49 → 500 credits
  99:  1000, // ¥99 → 1000 credits
};

// POST /api/pay/create — 创建支付订单
app.post('/api/pay/create', requireAuth, async (req, res) => {
  const { product_type, amount, pay_method } = req.body;
  if (!product_type || !amount) return res.status(400).json({ error: 'product_type and amount required' });
  if (!['wechat', 'alipay'].includes(pay_method)) return res.status(400).json({ error: 'invalid pay_method' });

  // Demo 模式
  if (IS_DEMO) {
    const orderNo = makeOrderNo();
    // Demo: 直接标记为 paid，添加额度
    if (product_type === 'credit') {
      const credits = CREDIT_PACKAGES[amount] || Math.floor(amount * 10);
      await pool.execute('UPDATE users SET free_credit = free_credit + ? WHERE id = ?', [credits, req.user.userId]);
    } else {
      await activateSubscription(req.user.userId, product_type, amount);
    }
    return res.json({ demo: true, order_no: orderNo, status: 'paid' });
  }

  // 正式模式：调虎皮椒 API
  const orderNo = makeOrderNo();
  const credits = CREDIT_PACKAGES[amount] || Math.floor(amount * 10);
  const pay_type = pay_method === 'wechat' ? 1 : 2; // 1=微信 2=支付宝

  try {
    const params = {
      appid: HUPIJIAO_APP_ID,
      appsecret: HUPIJIAO_APP_KEY,
      out_trade_no: orderNo,
      total_fee: Math.round(amount * 100), // 分为单位
      pay_type: pay_type,
      return_url: process.env.PAY_RETURN_URL || `http://localhost:4000/dashboard.html`,
      notify_url: process.env.PAY_NOTIFY_URL || `http://localhost:3001/api/pay/notify`,
      subject: `FlowMind-${product_type}`,
      body: `FlowMind-${product_type}`,
    };

    // 生成签名
    const sorted = Object.keys(params).sort();
    const signStr = sorted.map(k => k + '=' + params[k]).join('&') + '&key=' + HUPIJIAO_APP_KEY;
    params.sign = crypto.createHash('md5').update(signStr).digest('hex').toUpperCase();

    const resp = await fetch(`${HUPIJIAO_URL}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    const data = await resp.json();
    if (data.code !== 1 || !data.pay_url) {
      return res.status(400).json({ error: data.msg || '虎皮椒下单失败' });
    }

    // 保存 pending 订单
    await pool.execute(
      'INSERT INTO orders (order_no, user_id, product_type, amount, pay_method, status) VALUES (?, ?, ?, ?, ?, ?)',
      [orderNo, req.user.userId, product_type, amount, pay_method, 'pending']
    );

    res.json({ order_no: orderNo, pay_url: data.pay_url });
  } catch (err) {
    console.error('Hupijiao error:', err);
    res.status(500).json({ error: '支付服务异常，请稍后重试' });
  }
});

// GET /api/pay/status — 查询订单状态（前端轮询）
app.get('/api/pay/status', requireAuth, async (req, res) => {
  const { order_no } = req.query;
  if (!order_no) return res.status(400).json({ error: 'order_no required' });
  try {
    const [rows] = await pool.execute(
      'SELECT status FROM orders WHERE order_no = ? AND user_id = ?',
      [order_no, req.user.userId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'order not found' });
    res.json({ status: rows[0].status });
  } catch (err) {
    res.status(500).json({ error: 'database error' });
  }
});

// POST /api/pay/notify — 虎皮椒异步回调
app.post('/api/pay/notify', async (req, res) => {
  // 验证签名
  const { trade_no, out_trade_no, total_fee, pay_type, sign } = req.body;
  if (!out_trade_no) return res.send('fail');

  try {
    // 验证签名
    const params = { ...req.body };
    const receivedSign = params.sign;
    delete params.sign;
    delete params.attach;
    const sorted = Object.keys(params).sort();
    const expectedSign = crypto.createHash('md5')
      .update(sorted.map(k => k + '=' + params[k]).join('&') + '&key=' + HUPIJIAO_APP_KEY)
      .digest('hex').toUpperCase();

    if (receivedSign !== expectedSign) {
      console.error('Hupijiao notify: signature mismatch');
      return res.send('fail');
    }

    const [orders] = await pool.execute(
      'SELECT * FROM orders WHERE order_no = ? AND status = ?',
      [out_trade_no, 'pending']
    );
    if (!orders[0]) return res.send('success'); // 已处理或不存在

    const order = orders[0];
    const amount = parseFloat(total_fee) / 100;

    // 激活额度或订阅
    if (order.product_type === 'credit') {
      const credits = CREDIT_PACKAGES[order.amount] || Math.floor(order.amount * 10);
      await pool.execute('UPDATE users SET free_credit = free_credit + ? WHERE id = ?', [credits, order.user_id]);
    } else {
      await activateSubscription(order.user_id, order.product_type, order.amount);
    }

    await pool.execute(
      'UPDATE orders SET status = ?, paid_at = NOW() WHERE order_no = ?',
      ['paid', out_trade_no]
    );

    res.send('success');
  } catch (err) {
    console.error('Notify error:', err);
    res.send('fail');
  }
});

async function activateSubscription(userId, productType, amount) {
  let days;
  switch (productType) {
    case 'personal_monthly': days = 30;  break;
    case 'personal_yearly':   days = 365; break;
    case 'team_monthly':      days = 30;  break;
    case 'team_yearly':       days = 365; break;
    default: return;
  }
  const plan = productType.startsWith('team') ? 'team' : 'personal';
  const expiresAt = new Date(Date.now() + days * 86400000).toISOString().slice(0, 19).replace('T', ' ');

  await pool.execute(
    `INSERT INTO subscriptions (user_id, plan, status, expires_at)
     VALUES (?, ?, 'active', ?)
     ON DUPLICATE KEY UPDATE plan = ?, status = 'active', expires_at = ?`,
    [userId, plan, expiresAt, plan, expiresAt]
  );
}

// GET /api/health
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    siliconflowConfigured: !!SF_API_KEY,
    mysqlConfigured: !!pool,
    hupijiaoConfigured: !IS_DEMO,
    demoMode: IS_DEMO,
  });
});

app.listen(PORT, async () => {
  console.log(`🚀 FlowMind API running on http://localhost:${PORT}`);
  // 不阻塞启动，但确保 initTables 执行完
  initTables().catch(e => console.error('❌ initTables error:', e.message));
  if (!SF_API_KEY) console.warn('⚠️  SILICONFLOW_API_KEY not set');
  if (IS_DEMO) console.log('💡 虎皮椒未配置，运行在 Demo 模式（支付直接到账）');
  else console.log('✅ 虎皮椒已配置，支付通道开启');
  console.log(`✅ MySQL: ${MYSQL.host}:${MYSQL.port}/${MYSQL.database}`);
});
