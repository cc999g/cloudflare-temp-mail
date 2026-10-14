# Cloudflare 临时邮箱（网页端部署版）

> 本项目是开源项目 **[dreamhunter2333/cloudflare_temp_email](https://github.com/dreamhunter2333/cloudflare_temp_email)** 的**网页端部署记录与配置指南**，并非重新开发。
> 原项目：CloudFlare free temp domain email 免费/临时域名邮箱（支持附件、IMAP/SMTP 代理、TelegramBot、AI 提取验证码）。

## ✅ 已部署组件

| 组件 | 说明 |
|---|---|
| 后端 Worker | `temp-mail-api`（收信/发信/API） |
| 前端 Pages | `temp-mail-web`（网页端随机邮箱界面） |
| Email Routing | Catch-all `*@<你的域名>` → Worker |
| D1 数据库 | 邮箱/用户/邮件存储 |

## 🚀 网页端部署步骤（Cloudflare Dashboard 手动操作）

### 1. 准备
- Cloudflare 账号 + 一个**一级域名**（例如 `yourdomain.com`）
- ⚠️ 注意：Email Routing 的 Catch-all 通配规则**只支持主域名（apex），不支持子域名**；前端默认域名列表必须填主域名
- 从原项目 [Releases](https://github.com/dreamhunter2333/cloudflare_temp_email/releases) 获取 `frontend.zip` 与 Worker 代码

### 2. 创建 D1 数据库
1. Dashboard → **Workers & Pages → D1** → 创建数据库（如 `temp-mail-db`）
2. 在控制台执行原项目 **main 分支 `db/schema.sql`** 建表
3. ⚠️ **表结构必须与代码版本匹配**，否则会报 `no such column: password` / `no such column: user_email`；不匹配时直接用 main 分支最新 `db/schema.sql` 重建最快
4. 管理员账号需按原项目说明手动插入 `admin` 表

### 3. 部署后端 Worker（temp-mail-api）
1. **Workers & Pages → 创建 Worker** → 粘贴 Worker 代码（需包含邮件路由处理与 D1 binding）
2. 在 Worker 设置中绑定 D1 数据库
3. 按原项目 README 配置环境变量（域名列表、管理密码等）

### 4. 配置 Email Routing
1. 域名 → **Email**（邮件路由）→ 启用
2. 设置 **Catch-all**（中文界面为「全部捕获」）：
   - 规则：`*@<你的域名>`
   - 动作：**Send to Worker → temp-mail-api**
3. ⚠️ 域名列表未设置 / 1016 错误，都是这里没配好或 Worker 未处理邮件路由

### 5. 部署前端 Pages（temp-mail-web）
1. **Workers & Pages → Pages → 创建项目** → 上传 `frontend.zip`
2. ⚠️ 若前端弹窗 **Network Error / ERR_CONNECTION_RESET**：前端里 **硬编码了默认 API 地址**，需把 `temp-mail-api.xxx.xxx/open_api/...` 替换为你自己的 Worker 地址（如 `https://temp-mail-api.<你的子域名>.workers.dev`）

### 6. 验证
- 打开前端（Pages 域名或 `mail.<你的域名>`）
- 生成随机邮箱 → 用任意邮箱发信测试收件
- **管理员登录走 `/admin` 路径**（普通登录是用户邮箱，会报「用户不存在」）

## 🐛 常见问题（踩坑记录）

| 现象 | 原因 | 解决 |
|---|---|---|
| 网页 1016 / 404 | Email Routing 未指向 Worker / Worker 未处理邮件 | 检查 Catch-all 规则与 Worker 邮件路由 |
| Network Error / ERR_CONNECTION_RESET | 前端硬编码 API 地址 | 替换为你的 Worker 地址 |
| `D1_ERROR: no such column: password` | 表结构与代码版本不匹配 | 用 main 分支 `db/schema.sql` 重建 D1 |
| `D1_ERROR: no such column: user_email` | 同上 | 同上 |
| 400 用户不存在 | 走了普通登录而非 admin | 管理员用 `/admin` 路径登录 |
| 域名列表未设置 | 环境变量 DOMAINS 未配置主域名 | 填入你的主域名 |
| 收不到信 / 凭据登录不了 | Catch-all 规则或 D1 表异常 | 按上面两步排查 |

## 📁 仓库内容

```
├── README.md          # 本文件（部署指南 + 踩坑记录）
├── wrangler.toml      # Worker 部署配置模板（占位符）
└── .gitignore
```

> 本仓库**不含原项目源码**（版权归原项目所有），仅含部署指南与配置模板。

## 📄 来源与版权

- 原项目：https://github.com/dreamhunter2333/cloudflare_temp_email （MIT License，10K+ stars）
- 本仓库为部署记录，独立维护

---

*本项目由 AI 辅助生成。*
