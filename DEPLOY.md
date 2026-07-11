# Wordaydream 部署指南

## 架构总览

```
用户浏览器 (HTTPS)
      ↓
阿里云服务器
  ├── Nginx (端口 80/443)
  │     ├── 静态文件 /var/www/wordaydream/  (前端 dist/)
  │     └── /api/llm-proxy → 反向代理到 ↓
  └── Node.js LLM 代理 (端口 3001, PM2 管理)
        └── 调用 DeepSeek API (服务端持 key, 前端看不到)
```

## 前置条件

- 阿里云服务器 (Ubuntu/Debian, 2G 内存)
- 域名已解析到服务器 IP (A 记录)
- SSH 登录权限
- DeepSeek API key

---

## 第一步: 本地构建前端

在你的电脑上执行:

```bash
cd "w:\项目仓库\For trae\wordaydream"

# 1. 修改 .env 中的 VITE_LLM_PROXY_URL
#    改为: https://your-domain.com/api/llm-proxy
#    (your-domain.com 换成你的真实域名)

# 2. 构建
npm run build

# 3. 构建产物在 dist/ 目录
```

## 第二步: 上传文件到服务器

### 2.1 上传前端静态文件

```bash
# 在本地电脑执行 (把 user 换成你的用户名, ip 换成服务器 IP)
scp -r dist/* user@your-server-ip:/var/www/wordaydream/
```

或用 WinSCP / FileZilla 拖拽上传 `dist/` 里的所有文件到 `/var/www/wordaydream/`

### 2.2 上传 LLM 代理服务

```bash
# 上传 server/ 目录到服务器
scp -r server/ user@your-server-ip:~/wordaydream-proxy/
```

---

## 第三步: 服务器环境配置

SSH 登录服务器后执行:

### 3.1 安装 Node.js 22.x

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# 验证
node -v   # 应显示 v22.x.x
npm -v    # 应显示 10.x.x
```

### 3.2 安装 PM2 (进程管理)

```bash
sudo npm install -g pm2

# 验证
pm2 -v
```

### 3.3 安装 Nginx

```bash
sudo apt update
sudo apt install -y nginx

# 验证
nginx -v
```

### 3.4 创建网站目录

```bash
sudo mkdir -p /var/www/wordaydream
sudo chown -R $USER:$USER /var/www/wordaydream
```

---

## 第四步: 启动 LLM 代理服务

### 4.1 安装依赖

```bash
cd ~/wordaydream-proxy
npm install
```

### 4.2 配置 API key

```bash
# 编辑 .env 文件, 填入你的 DeepSeek API key
nano .env
```

确认 .env 内容:
```
DEEPSEEK_API_KEY=sk-你的key
PORT=3001
```

### 4.3 用 PM2 启动

```bash
# 需要让 .env 环境变量生效, 用 dotenv 或直接 source
# 最简方案: 把 key 写入 PM2 配置
nano ecosystem.config.cjs
# 取消 DEEPSEEK_API_KEY 那行的注释, 填入你的 key

# 启动
pm2 start ecosystem.config.cjs

# 查看日志
pm2 logs wordaydream-proxy

# 验证服务正常
curl http://localhost:3001/health
# 应返回: {"status":"ok","timestamp":...}

# 设置开机自启
pm2 save
pm2 startup
# 按提示执行返回的命令 (类似 sudo env PATH=... pm2 startup ...)
```

---

## 第五步: 配置 Nginx

### 5.1 创建配置文件

```bash
sudo nano /etc/nginx/sites-available/wordaydream
```

粘贴 `server/nginx.conf` 的内容, 把 `your-domain.com` 替换为你的真实域名。

### 5.2 启用配置

```bash
sudo ln -s /etc/nginx/sites-available/wordaydream /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default   # 删除默认配置
sudo nginx -t                               # 测试配置
sudo systemctl reload nginx                 # 重载
```

### 5.3 验证

```bash
# 在服务器上测试
curl http://localhost/api/llm-proxy
# 应返回 JSON 错误 (因为用 GET 访问了 POST 端点), 说明 Nginx 转发正常

# 在本地电脑浏览器访问
# http://your-domain.com  应该看到首页
```

---

## 第六步: 配置 HTTPS (Let's Encrypt 免费证书)

PWA 和 Service Worker 必须 HTTPS 才能工作。

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

按提示操作:
- 输入邮箱
- 同意条款
- 选择重定向 HTTP → HTTPS (选 2)

### 验证 HTTPS

```bash
# 访问 https://your-domain.com 应正常显示
# HTTP 访问应自动跳转到 HTTPS
```

---

## 第七步: 阿里云安全组配置

在阿里云控制台 → ECS → 安全组 → 添加规则:

| 端口 | 协议 | 方向 | 说明 |
|------|------|------|------|
| 80 | TCP | 入方向 | HTTP |
| 443 | TCP | 入方向 | HTTPS |
| 22 | TCP | 入方向 | SSH |

**不要**开放 3001 端口, LLM 代理只通过 Nginx 反向代理访问。

---

## 验证完整流程

1. 浏览器访问 `https://your-domain.com` → 看到首页
2. 进入阅读页 → 点击生成文章 → DeepSeek API 返回真实文章
3. 点击单词 → 输入翻译 → AI 评估 → 正常反馈
4. 语法点面板、设置面板、复习系统全部正常

---

## 内存占用预估

| 组件 | 内存 |
|------|------|
| 系统 | ~200MB |
| Nginx | ~20MB |
| Node.js LLM 代理 | ~80MB |
| PM2 | ~30MB |
| **总计** | **~330MB** |
| **剩余可用** | **~1.7GB** |

2G 内存完全够用。

---

## 日常维护

### 更新前端代码

```bash
# 本地电脑
npm run build
scp -r dist/* user@your-server-ip:/var/www/wordaydream/
# 无需重启 Nginx, 静态文件即时生效
```

### 更新 LLM 代理代码

```bash
# 上传新代码后
scp -r server/ user@your-server-ip:~/wordaydream-proxy/

# 服务器上
cd ~/wordaydream-proxy
npm install        # 如果依赖有变化
pm2 restart wordaydream-proxy
```

### 查看日志

```bash
# LLM 代理日志
pm2 logs wordaydream-proxy

# Nginx 日志
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### 常见问题

**Q: 生成文章失败, 提示 "API key not configured"**
A: 检查 PM2 配置中 DEEPSEEK_API_KEY 是否正确设置, `pm2 restart wordaydream-proxy`

**Q: 生成文章很慢**
A: DeepSeek API 响应时间 5-15 秒属正常, 看文章难度设置

**Q: PWA 离线模式不工作**
A: 必须 HTTPS, 检查证书是否有效

**Q: 502 Bad Gateway**
A: LLM 代理服务未运行, `pm2 status` 检查, `pm2 restart wordaydream-proxy`
