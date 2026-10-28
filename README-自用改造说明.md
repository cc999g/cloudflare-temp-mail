# 临时邮箱项目 · 自用改造说明

> 改造日期：2026-10-28
> 线上访问：https://mail.yccm.de5.net（或 https://yccm.de5.net）
> 后端 API：https://mail-api.yccm.de5.net（绑定 temp-mail-api，原有自定义域，未改动）

## 一、本次改造内容

| 需求 | 实现方式 | 状态 |
|---|---|---|
| 管理员可查看所有邮件内容 | 管理员登录后进入后台「邮件管理」，可看全部邮件列表与正文 | ✅ |
| 只有管理员可新增用户账户并设定密码 | 自助注册已强制关闭（接口返回 403），仅后台「用户管理 → 创建用户」可建号 | ✅ |
| 取消凭证登录 | 地址凭证登录接口已关闭（403）；匿名创建邮箱已关闭（401） | ✅ |
| 每次使用都要输入账户密码 | 登录凭证仅保存在当前浏览器会话（sessionStorage），关闭浏览器后需重新登录 | ✅ |
| 取消地址密码登录 | 地址密码功能已关闭（ENABLE_ADDRESS_PASSWORD=false），前端入口自动隐藏 | ✅ |

## 二、管理员账号（首次登录用）

- 账户名：`admin`
- 初始密码：`rAAZhM@#eoihj6`
- 登录后建议立即在后台「用户管理」中修改为自己的密码
- 该账号已设置 `admin` 角色，登录后自动拥有后台权限（可建号、重置密码、看全部邮件）

## 三、使用流程

### 管理员
1. 打开 https://mail.yccm.de5.net → 顶部「用户中心」→ 输入 admin 账户密码登录
2. 进入「管理后台」→「用户管理」→「创建用户」：填账户名 + 密码（无需邮箱格式，任意字符串即可）
3. 「邮件管理」可查看所有用户所有邮箱的邮件内容

### 普通用户
1. 打开网站 → 输入管理员分配的账户名 + 密码登录（无注册入口，账号由管理员创建）
2. 登录后在用户中心「新建邮箱」，创建后自动绑定到自己的账号
3. 每次关闭浏览器后再次访问，需重新输入账户密码

## 四、已关闭的能力（如需要可再开启）

- 用户自助注册：`worker/src/user_api/user.ts` register 返回 403 处
- 地址凭证登录：`worker/src/open_api/auth.ts` credential_login 返回 403 处
- 匿名创建邮箱：`worker/src/worker.ts` /api/new_address 强制登录处
- 地址密码登录：worker 环境变量 `ENABLE_ADDRESS_PASSWORD`（当前 false）

## 五、部署配置（worker/wrangler.toml）

```toml
name = "temp-mail-api"
DB = temp-mail-db (D1)
KV = temp-mail-kv
DOMAINS = ["yccm.de5.net"]
DEFAULT_LANG = "zh"
ADMIN_PASSWORDS = ["yc123456"]   # 后台管理密码（兜底入口）
ADMIN_USER_ROLE = "admin"        # 管理员用户角色
USER_ROLES = '[{"role":"admin","prefix":"","domains":["yccm.de5.net"]}]'
JWT_SECRET = "a54bf45f..."       # 已更换为强密钥
ENABLE_ADDRESS_PASSWORD = "false"
```

## 六、验证结果（2026-10-28 部署后实测）

- 生产域名 mail.yccm.de5.net / yccm.de5.net：200 ✅
- 自助注册 /user_api/register：403 ✅
- 凭证登录 /open_api/credential_login：403 ✅
- 匿名创建邮箱 /api/new_address：401 ✅
- 管理员登录（admin 角色生效 is_admin=True）✅
- 管理员读全部邮件 /admin/mails（含正文）✅
- 管理员创建用户 /admin/users POST ✅
- 用户登录 → 创建邮箱 → 绑定账号 → 读邮件 全链路 ✅
- 测试数据已清理，线上仅保留 admin 账户
