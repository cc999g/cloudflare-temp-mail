import { Hono } from 'hono'

import utils, { checkCfTurnstile, getPasswords, getAdminPasswords, hashPassword } from '../utils';
import i18n from '../i18n';
import { ErrorCode } from '../error_codes';

const api = new Hono<HonoCustomType>()

api.post('/open_api/site_login', async (c) => {
    const { password, cf_token } = await c.req.json();
    const msgs = i18n.getMessagesbyContext(c);
    if (utils.isGlobalTurnstileEnabled(c)) {
        try {
            await checkCfTurnstile(c, cf_token);
        } catch (error) {
            return c.text(msgs.TurnstileCheckFailedMsg, 400)
        }
    }
    const passwords = getPasswords(c);
    const hashedPasswords = await Promise.all(passwords.map(p => hashPassword(p)));
    if (!hashedPasswords.length || !password || !hashedPasswords.includes(password)) {
        return c.json({ code: ErrorCode.AUTH_SITE_PASSWORD_INVALID, message: msgs.CustomAuthPasswordMsg }, 401)
    }
    return c.json({ success: true })
})

api.post('/open_api/admin_login', async (c) => {
    const { password, cf_token } = await c.req.json();
    const msgs = i18n.getMessagesbyContext(c);
    if (utils.isGlobalTurnstileEnabled(c)) {
        try {
            await checkCfTurnstile(c, cf_token);
        } catch (error) {
            return c.text(msgs.TurnstileCheckFailedMsg, 400)
        }
    }
    const adminPasswords = getAdminPasswords(c);
    const hashedPasswords = await Promise.all(adminPasswords.map(p => hashPassword(p)));
    if (!hashedPasswords.length || !password || !hashedPasswords.includes(password)) {
        return c.json({ code: ErrorCode.AUTH_ADMIN_CREDENTIAL_INVALID, message: msgs.NeedAdminPasswordMsg }, 401)
    }
    return c.json({ success: true })
})

api.post('/open_api/credential_login', async (c) => {
    const msgs = i18n.getMessagesbyContext(c);
    // [自用定制] 关闭地址凭证登录：统一改为账户密码登录。
    // 地址凭证仅用于已登录用户在其绑定邮箱间切换（/user_api/bind_address_jwt 内部链路）。
    return c.json({ code: ErrorCode.AUTH_SITE_PASSWORD_INVALID, message: msgs.CustomAuthPasswordMsg }, 403)
})

export { api }
