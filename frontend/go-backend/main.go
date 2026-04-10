package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	_ "github.com/go-sql-driver/mysql"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB
var jwtSecret = []byte("flowmind-secret-key-change-in-production")
var sfAPIKey = "sk-uieesbukszusecczzlezyhxovkjcjeanqzcpglnaejasaqha"

var platformPrompts = map[string]string{
	"xiaohongshu": `你是一个专业的小红书内容创作者。把给定的原始文章改写成小红书风格的笔记。

要求：
- 加入适量 emoji，每个段落开头用 emoji 引入
- 分成短段落，每段不超过3行
- 结尾加上 3-5 个相关热门话题标签，以 # 开头
- 语气亲切、接地气，像和朋友聊天
- 标题要吸睛，在开头直接说"必看"/"分享"/"干货"
- 总字数控制在 300-800 字

直接返回改写内容，不要加任何前缀说明。`,

	"twitter": `You are a professional Twitter/X content creator. Rewrite the given article as a Twitter thread in English.

Requirements:
- Use numbered format: 1/, 2/, 3/ etc.
- Each tweet max 280 characters
- Make the first tweet a strong hook
- Punchy, direct, no fluff
- End with relevant hashtags
- Thread should be 3-5 tweets total
- Preserve the core insight from the original

Return ONLY the thread content, no explanations. Use \n---\n to separate tweets.`,

	"gongzhonghao": `你是一个专业公众号内容创作者。把给定的原始文章改写成公众号风格长文。

要求：
- 开头要有引导语，吸引读者往下看
- 标题用【】包裹，要有信息量
- 保留文章的深度和完整性
- 段落分明，适当加粗关键句子（用**包裹）
- 不加 emoji，保持专业但有温度
- 字数控制在 800-1500 字

直接返回改写内容，不要加前缀说明。`,

	"douyin": `你是一个专业抖音文案创作者。把给定的原始文章改写成抖音风格短视频文案。

要求：
- 开头要有代入感，像和观众聊天，不要太夸张
- 不要用"震惊"、"99%人不知道"、"逆袭"等夸张词汇
- 中间内容要真实自然，有共鸣
- 结尾可以用轻松的方式引导互动
- 语气真实、接地气，不油腻
- 总字数 150-250 字

直接返回改写内容，不要加前缀说明。`,

	"weibo": `你是一个专业微博内容创作者。把给定的原始文章改写成微博风格短内容。

要求：
- 开头要有爆点，一句话抓住注意力
- 可以中英混杂
- 适当使用 emoji，但不要过度
- 带上 1-2 个话题标签
- 语气轻松有态度
- 字数 100-300 字

直接返回改写内容，不要加前缀说明。`,
}

type User struct {
	ID          int64     `json:"id"`
	Email       string    `json:"email"`
	Password    string    `json:"-"`
	FreeCredit  float64   `json:"free_credit"`
	CreatedAt   time.Time `json:"created_at"`
}

type RegisterRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=6"`
}

type LoginRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

type RewriteRequest struct {
	Platforms []string `json:"platforms" binding:"required"`
	Content   string   `json:"content" binding:"required"`
}

type RewriteResult struct {
	Platform     string `json:"platform"`
	PlatformName string `json:"platformName"`
	Content      string `json:"content"`
	Error        bool   `json:"error,omitempty"`
}

type SFMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type SFRequest struct {
	Model     string      `json:"model"`
	MaxTokens int         `json:"max_tokens"`
	Messages  []SFMessage `json:"messages"`
}

type SFChoice struct {
	Message struct {
		Content string `json:"content"`
	} `json:"message"`
}

type SFResponse struct {
	Choices []SFChoice `json:"choices"`
}

func main() {
	var err error
	dsn := "root:flowmind123@tcp(127.0.0.1:3306)/flowmind?charset=utf8mb4&parseTime=True&loc=Local"
	db, err = sql.Open("mysql", dsn)
	if err != nil {
		log.Fatal(err)
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	if err = db.Ping(); err != nil {
		log.Fatal("DB connection failed:", err)
	}
	log.Println("✅ MySQL connected")

	r := gin.Default()

	// CORS
	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	r.GET("/api/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	r.POST("/api/auth/register", register)
	r.POST("/api/auth/login", login)

	auth := r.Group("/api")
	auth.Use(authMiddleware())
	{
		auth.POST("/rewrite", rewrite)
		auth.GET("/user/info", getUserInfo)
		auth.GET("/user/credit", getUserCredit)
	}

	log.Println("🚀 FlowMind API running on :3002")
	r.Run(":3002")
}

func register(c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": "invalid request: " + err.Error()})
		return
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(500, gin.H{"error": "failed to hash password"})
		return
	}

	// Check if email exists
	var count int
	db.QueryRow("SELECT COUNT(*) FROM users WHERE email = ?", req.Email).Scan(&count)
	if count > 0 {
		c.JSON(400, gin.H{"error": "email already registered"})
		return
	}

	result, err := db.Exec(
		"INSERT INTO users (email, password, free_credit) VALUES (?, ?, ?)",
		req.Email, string(hashed), 0.01,
	)
	if err != nil {
		c.JSON(500, gin.H{"error": "failed to create user"})
		return
	}

	id, _ := result.LastInsertId()
	token := generateToken(id)

	c.JSON(200, gin.H{
		"token":       token,
		"user_id":     id,
		"email":       req.Email,
		"free_credit": 0.01,
	})
}

func login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": "invalid request"})
		return
	}

	var user User
	var hashedPwd string
	err := db.QueryRow("SELECT id, email, password, free_credit FROM users WHERE email = ?", req.Email).
		Scan(&user.ID, &user.Email, &hashedPwd, &user.FreeCredit)
	if err == sql.ErrNoRows {
		c.JSON(401, gin.H{"error": "invalid email or password"})
		return
	} else if err != nil {
		c.JSON(500, gin.H{"error": "database error"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(hashedPwd), []byte(req.Password)); err != nil {
		c.JSON(401, gin.H{"error": "invalid email or password"})
		return
	}

	token := generateToken(user.ID)
	c.JSON(200, gin.H{
		"token":       token,
		"user_id":     user.ID,
		"email":       user.Email,
		"free_credit": user.FreeCredit,
	})
}

func rewrite(c *gin.Context) {
	userID := c.GetInt64("user_id")

	// Check credit
	var credit float64
	db.QueryRow("SELECT free_credit FROM users WHERE id = ?", userID).Scan(&credit)
	if credit < 0.001 {
		c.JSON(402, gin.H{"error": "insufficient credit, please top up"})
		return
	}

	var req RewriteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": "invalid request"})
		return
	}

	platformNames := map[string]string{
		"xiaohongshu":  "小红书",
		"twitter":      "Twitter/X",
		"gongzhonghao": "公众号",
		"douyin":       "抖音",
		"weibo":        "微博",
	}

	creditPerPlatform := 0.001
	totalDeduct := creditPerPlatform * float64(len(req.Platforms))
	newCredit := credit - totalDeduct

	// Mark credit as pending (set to 0 first to avoid overspending)
	db.Exec("UPDATE users SET free_credit = ? WHERE id = ?", 0, userID)

	results := []RewriteResult{}
	for _, platform := range req.Platforms {
		prompt, ok := platformPrompts[platform]
		if !ok {
			results = append(results, RewriteResult{
				Platform: platform, PlatformName: platformNames[platform],
				Content: "unknown platform", Error: true,
			})
			continue
		}

		// Call SiliconFlow
		sfReq := SFRequest{
			Model:     "deepseek-ai/DeepSeek-V3",
			MaxTokens: 1024,
			Messages: []SFMessage{
				{Role: "user", Content: prompt + "\n\n原始内容：\n" + req.Content},
			},
		}

		body, _ := json.Marshal(sfReq)
		httpReq, _ := http.NewRequest("POST", "https://api.siliconflow.cn/v1/chat/completions", bytes.NewBuffer(body))
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("Authorization", "Bearer "+sfAPIKey)

		resp, err := http.DefaultClient.Do(httpReq)
		if err != nil || resp.StatusCode != 200 {
			results = append(results, RewriteResult{
				Platform: platform, PlatformName: platformNames[platform],
				Content: "API error", Error: true,
			})
			continue
		}
		defer resp.Body.Close()

		var sfResp SFResponse
		json.NewDecoder(resp.Body).Decode(&sfResp)

		if len(sfResp.Choices) == 0 {
			results = append(results, RewriteResult{
				Platform: platform, PlatformName: platformNames[platform],
				Content: "no response from AI", Error: true,
			})
			continue
		}

		results = append(results, RewriteResult{
			Platform: platform, PlatformName: platformNames[platform],
			Content: sfResp.Choices[0].Message.Content,
		})
	}

	// Log
	db.Exec("INSERT INTO rewrite_logs (user_id, content, platform, credit_used) VALUES (?, ?, ?, ?)",
		userID, req.Content, strings.Join(req.Platforms, ","), totalDeduct)

	// Update credit
	db.Exec("UPDATE users SET free_credit = ? WHERE id = ?", newCredit, userID)

	c.JSON(200, gin.H{
		"results":       results,
		"credit_remain": newCredit,
	})
}

func getUserInfo(c *gin.Context) {
	userID := c.GetInt64("user_id")
	var user User
	db.QueryRow("SELECT id, email, free_credit, created_at FROM users WHERE id = ?", userID).
		Scan(&user.ID, &user.Email, &user.FreeCredit, &user.CreatedAt)
	c.JSON(200, gin.H{
		"id":         user.ID,
		"email":      user.Email,
		"free_credit": user.FreeCredit,
		"created_at": user.CreatedAt,
	})
}

func getUserCredit(c *gin.Context) {
	userID := c.GetInt64("user_id")
	var credit float64
	db.QueryRow("SELECT free_credit FROM users WHERE id = ?", userID).Scan(&credit)
	c.JSON(200, gin.H{"credit": credit})
}

func generateToken(userID int64) string {
	claims := jwt.MapClaims{
		"user_id": userID,
		"exp":     time.Now().Add(7 * 24 * time.Hour).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, _ := token.SignedString(jwtSecret)
	return tokenString
}

func authMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.AbortWithStatusJSON(401, gin.H{"error": "authorization header required"})
			return
		}

		tokenString := strings.TrimPrefix(authHeader, "Bearer ")
		token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method")
			}
			return jwtSecret, nil
		})

		if err != nil || !token.Valid {
			c.AbortWithStatusJSON(401, gin.H{"error": "invalid token"})
			return
		}

		claims := token.Claims.(jwt.MapClaims)
		userID := int64(claims["user_id"].(float64))
		c.Set("user_id", userID)
		c.Next()
	}
}
