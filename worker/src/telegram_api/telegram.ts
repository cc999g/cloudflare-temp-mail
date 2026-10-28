
import { Context } from "hono";
import { Telegraf, Context as TgContext, Markup } from "telegraf";
import { callbackQuery } from "telegraf/filters";

import { CONSTANTS } from "../constants";
import { getBooleanValue, getDomains, getJsonObjectValue, trimLower, htmlToText } from '../utils';
import { TelegramSettings } from "./settings";
import { sendTelegramAttachments } from "./tg_file_upload";
import { bindTelegramAddress, deleteTelegramAddress, jwtListToAddressData, tgUserNewAddress, unbindTelegramAddress, unbindTelegramByAddress } from "./common";
import { commonParseMail } from "../common";
import { deleteAddressWithData } from "../common";
import { resolveRawEmail } from "../gzip";
import { UserFromGetMe } from "telegraf/types";
import i18n from "../i18n";
import { LocaleMessages } from "../i18n/type";
import type { ExtractResult, RawMailRow } from "../models";


// Helper to get messages by userId
const getTgMessages = async (
    c: Context<HonoCustomType>,
    ctx?: TgContext,
    userId?: string | null
): Promise<LocaleMessages> => {
    // Check if user language config is enabled (default false)
    if (!getBooleanValue(c.env.TG_ALLOW_USER_LANG)) {
        return i18n.getMessages(c.env.DEFAULT_LANG || 'zh');
    }

    const uid = userId || ctx?.message?.from?.id?.toString() || ctx?.callbackQuery?.from?.id?.toString();
    if (uid) {
        const savedLang = await c.env.KV.get(`${CONSTANTS.TG_KV_PREFIX}:lang:${uid}`);
        if (savedLang) { return i18n.getMessages(savedLang); }
    }
    return i18n.getMessages(c.env.DEFAULT_LANG || 'zh');
};

// Bilingual command descriptions with full usage instructions
const COMMANDS = [
    {
        command: "start",
        description: "开始使用 | Get started"
    },
    {
        command: "new",
        description: "新建邮箱, /new <name>@<domain>, name[a-z0-9]有效, 为空随机生成, @domain可选 | Create address, /new <name>@<domain>, name[a-z0-9] valid, empty=random, @domain optional"
    },
    {
        command: "address",
        description: "查看邮箱地址列表 | View address list"
    },
    {
        command: "bind",
        description: "绑定邮箱, /bind <邮箱地址凭证> | Bind address, /bind <credential>"
    },
    {
        command: "unbind",
        description: "解绑邮箱, /unbind <邮箱地址> | Unbind address, /unbind <address>"
    },
    {
        command: "delete",
        description: "删除邮箱, /delete <邮箱地址> | Delete address, /delete <address>"
    },
    {
        command: "mails",
        description: "查看邮件, /mails <邮箱地址>, 不输入地址默认第一个 | View mails, /mails <address>, default first if empty"
    },
    {
        command: "cleaninvalidaddress",
        description: "清理无效地址 | Clean invalid addresses"
    },
    {
        command: "lang",
        description: "设置语言 /lang <zh|en> | Set language /lang <zh|en>"
    },
]

const formatAiExtractForTelegram = (
    msgs: LocaleMessages,
    aiExtract?: ExtractResult | string | null
): string => {
    if (!aiExtract) {
        return "";
    }

    try {
        if (typeof aiExtract === "string") {
            const metadata = JSON.parse(aiExtract);
            aiExtract = metadata?.ai_extract;
        }
    } catch (error) {
        console.warn("Failed to parse AI extraction metadata", error);
        return "";
    }

    if (!aiExtract || typeof aiExtract !== "object") {
        return "";
    }

    const labels: Record<Exclude<ExtractResult["type"], "none">, string> = {
        auth_code: msgs.TgAiExtractAuthCodeMsg,
        auth_link: msgs.TgAiExtractAuthLinkMsg,
        service_link: msgs.TgAiExtractServiceLinkMsg,
        subscription_link: msgs.TgAiExtractSubscriptionLinkMsg,
        other_link: msgs.TgAiExtractOtherLinkMsg,
    };
    const label = labels[aiExtract.type as keyof typeof labels];
    const result = typeof aiExtract.result === "string"
        ? aiExtract.result.replace(/\s+/g, " ").trim().slice(0, 600)
        : "";
    if (!result) {
        return "";
    }

    if (!label) {
        return "";
    }

    const resultText = typeof aiExtract.result_text === "string"
        ? aiExtract.result_text.replace(/\s+/g, " ").trim().slice(0, 120)
        : "";
    const displayText = aiExtract.type !== "auth_code" && resultText && resultText !== result
        ? ` (${resultText})`
        : "";
    return `${msgs.TgAiExtractResultMsg}\n${label}: ${result}${displayText}\n\n`;
}

export const getTelegramCommands = (c: Context<HonoCustomType>) => {
    return getBooleanValue(c.env.TG_ALLOW_USER_LANG)
        ? COMMANDS
        : COMMANDS.filter(cmd => cmd.command !== "lang");
}

// [自用定制] TG Bot 绑定的账号默认管理员：
// 每个通过 TG Bot 私聊交互的用户，自动在 users 表映射为 tg_<userId> 账户，并默认授予 admin 角色。
const ensureTelegramUserAdmin = async (c: Context<HonoCustomType>, userId: string): Promise<void> => {
    const userEmail = `tg_${userId}`;
    // 随机占位密码（TG 用户不通过网页密码登录，仅用于满足非空约束）
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    const randomPassword = Array.from(randomBytes, b => b.toString(16).padStart(2, '0')).join('');
    const userInfo = JSON.stringify({ email: userEmail });
    await c.env.DB.prepare(
        `INSERT INTO users (user_email, password, user_info) VALUES (?, ?, ?)
         ON CONFLICT(user_email) DO UPDATE SET updated_at = datetime('now')`
    ).bind(userEmail, randomPassword, userInfo).run();
    await c.env.DB.prepare(
        `INSERT INTO user_roles (user_id, role_text)
         SELECT id, ? FROM users WHERE user_email = ?
         ON CONFLICT(user_id) DO UPDATE SET role_text = excluded.role_text, updated_at = datetime('now')`
    ).bind('admin', userEmail).run();
}

// [自用定制] Inline 键盘菜单：主菜单 + 邮箱二级子菜单（自用 bot，按钮文案使用中文+emoji）
const MENU_WEB_URL = 'https://mail.yccm.de5.net';

const mainMenuKeyboard = () => Markup.inlineKeyboard([
    [Markup.button.callback('📮 新建邮箱', 'btn:new')],
    [Markup.button.callback('📋 邮箱列表', 'btn:list'), Markup.button.callback('📥 最新邮件', 'btn:inbox')],
    [Markup.button.url('🌐 网页后台', MENU_WEB_URL)],
]);

const backToMenuButton = () => Markup.button.callback('🔙 返回菜单', 'btn:menu');

export function newTelegramBot(c: Context<HonoCustomType>, token: string): Telegraf {
    const bot = new Telegraf(token);
    const botInfo = getJsonObjectValue<UserFromGetMe>(c.env.TG_BOT_INFO);
    if (botInfo) {
        bot.botInfo = botInfo;
    }

    bot.use(async (ctx, next) => {
        // check if in private chat
        if (ctx.chat?.type !== "private") {
            return;
        }

        const userId = ctx?.message?.from?.id || ctx.callbackQuery?.message?.chat?.id;
        if (!userId) {
            const msgs = await getTgMessages(c, ctx);
            return await ctx.reply(msgs.TgUnableGetUserInfoMsg);
        }

        const settings = await c.env.KV.get<TelegramSettings>(CONSTANTS.TG_KV_SETTINGS_KEY, "json");
        if (settings?.enableAllowList
            && !settings.allowList.includes(userId.toString())
        ) {
            const msgs = await getTgMessages(c, ctx);
            return await ctx.reply(msgs.TgNoPermissionMsg);
        }
        try {
            // [自用定制] TG 用户默认映射为管理员账号
            await ensureTelegramUserAdmin(c, userId.toString());
            await next();
        } catch (error) {
            console.error(`Error: ${error}`);
            return await ctx.reply(`Error: ${error}`);
        }
    })

    bot.command("start", async (ctx: TgContext) => {
        const msgs = await getTgMessages(c, ctx);
        const prefix = trimLower(c.env.PREFIX)
        const domains = getDomains(c);
        const commands = getTelegramCommands(c);
        return await ctx.reply(
            `${msgs.TgWelcomeMsg}\n\n`
            + (prefix ? `${msgs.TgCurrentPrefixMsg} ${prefix}\n` : '')
            + `${msgs.TgCurrentDomainsMsg} ${JSON.stringify(domains)}\n`
            + `${msgs.TgAvailableCommandsMsg}\n`
            + commands.map(cmd => `/${cmd.command}: ${cmd.description}`).join("\n"),
            // [自用定制] 附带 Inline 按键主菜单
            { ...mainMenuKeyboard() }
        );
    });

    bot.command("new", async (ctx: TgContext) => {
        const msgs = await getTgMessages(c, ctx);
        const userId = ctx?.message?.from?.id;
        if (!userId) {
            return await ctx.reply(msgs.TgUnableGetUserInfoMsg);
        }
        try {
            // @ts-ignore
            const address = ctx?.message?.text.slice("/new".length).trim();
            const res = await tgUserNewAddress(c, userId.toString(), address, msgs);
            return await ctx.reply(`${msgs.TgCreateSuccessMsg}\n`
                + `${msgs.TgAddressMsg} ${res.address}\n`
                + (res.password ? `${msgs.TgPasswordMsg} \`${res.password}\`\n` : '')
                + `${msgs.TgCredentialMsg} \`${res.jwt}\`\n`,
                {
                    parse_mode: "Markdown"
                }
            );
        } catch (e) {
            return await ctx.reply(`${msgs.TgCreateFailedMsg} ${(e as Error).message}`);
        }
    });

    bot.command("bind", async (ctx: TgContext) => {
        const msgs = await getTgMessages(c, ctx);
        const userId = ctx?.message?.from?.id;
        if (!userId) {
            return await ctx.reply(msgs.TgUnableGetUserInfoMsg);
        }
        try {
            // @ts-ignore
            const jwt = ctx?.message?.text.slice("/bind".length).trim();
            if (!jwt) {
                return await ctx.reply(msgs.TgPleaseInputCredentialMsg);
            }
            const address = await bindTelegramAddress(c, userId.toString(), jwt, msgs);
            return await ctx.reply(`${msgs.TgBindSuccessMsg}\n`
                + `${msgs.TgAddressMsg} ${address}`
            );
        }
        catch (e) {
            return await ctx.reply(`${msgs.TgBindFailedMsg} ${(e as Error).message}`);
        }
    });

    bot.command("unbind", async (ctx: TgContext) => {
        const msgs = await getTgMessages(c, ctx);
        const userId = ctx?.message?.from?.id;
        if (!userId) {
            return await ctx.reply(msgs.TgUnableGetUserInfoMsg);
        }
        try {
            // @ts-ignore
            const address = ctx?.message?.text.slice("/unbind".length).trim();
            if (!address) {
                return await ctx.reply(msgs.TgPleaseInputAddressMsg);
            }
            await unbindTelegramAddress(c, userId.toString(), address);
            return await ctx.reply(`${msgs.TgUnbindSuccessMsg}\n${msgs.TgAddressMsg} ${address}`
            );
        }
        catch (e) {
            return await ctx.reply(`${msgs.TgUnbindFailedMsg} ${(e as Error).message}`);
        }
    })

    bot.command("delete", async (ctx: TgContext) => {
        const msgs = await getTgMessages(c, ctx);
        const userId = ctx?.message?.from?.id;
        if (!userId) {
            return await ctx.reply(msgs.TgUnableGetUserInfoMsg);
        }
        try {
            // @ts-ignore
            const address = ctx?.message?.text.slice("/delete".length).trim();
            if (!address) {
                return await ctx.reply(msgs.TgPleaseInputAddressMsg);
            }
            await deleteTelegramAddress(c, userId.toString(), address, msgs);
            return await ctx.reply(`${msgs.TgDeleteSuccessMsg} ${address}`);
        } catch (e) {
            return await ctx.reply(`${msgs.TgDeleteFailedMsg} ${(e as Error).message}`);
        }
    });

    bot.command("address", async (ctx) => {
        const msgs = await getTgMessages(c, ctx);
        const userId = ctx?.message?.from?.id;
        if (!userId) {
            return await ctx.reply(msgs.TgUnableGetUserInfoMsg);
        }
        try {
            const jwtList = await c.env.KV.get<string[]>(`${CONSTANTS.TG_KV_PREFIX}:${userId}`, 'json') || [];
            const { addressList } = await jwtListToAddressData(c, jwtList, msgs);
            return await ctx.reply(`${msgs.TgAddressListMsg}\n\n`
                + addressList.map(a => `${msgs.TgAddressMsg} ${a}`).join("\n")
            );
        } catch (e) {
            return await ctx.reply(`${msgs.TgGetAddressFailedMsg} ${(e as Error).message}`);
        }
    });

    bot.command("cleaninvalidaddress", async (ctx: TgContext) => {
        const msgs = await getTgMessages(c, ctx);
        const userId = ctx?.message?.from?.id;
        if (!userId) {
            return await ctx.reply(msgs.TgUnableGetUserInfoMsg);
        }
        try {
            const jwtList = await c.env.KV.get<string[]>(`${CONSTANTS.TG_KV_PREFIX}:${userId}`, 'json') || [];
            const { invalidJwtList } = await jwtListToAddressData(c, jwtList, msgs);
            const newJwtList = jwtList.filter(jwt => !invalidJwtList.includes(jwt));
            await c.env.KV.put(`${CONSTANTS.TG_KV_PREFIX}:${userId}`, JSON.stringify(newJwtList));
            const { addressList } = await jwtListToAddressData(c, newJwtList, msgs);
            return await ctx.reply(`${msgs.TgCleanSuccessMsg}\n\n`
                + `${msgs.TgCurrentAddressListMsg}\n\n`
                + addressList.map(a => `${msgs.TgAddressMsg} ${a}`).join("\n")
            );
        } catch (e) {
            return await ctx.reply(`${msgs.TgCleanFailedMsg} ${(e as Error).message}`);
        }
    });

    bot.command("lang", async (ctx: TgContext) => {
        const userId = ctx?.message?.from?.id;
        if (!userId) {
            const msgs = await getTgMessages(c, ctx);
            return await ctx.reply(msgs.TgUnableGetUserInfoMsg);
        }

        const msgs = await getTgMessages(c, ctx);

        // Check if user language config is enabled
        if (!getBooleanValue(c.env.TG_ALLOW_USER_LANG)) {
            return await ctx.reply(msgs.TgLangFeatureDisabledMsg);
        }

        // @ts-ignore
        const lang = ctx?.message?.text.slice("/lang".length).trim().toLowerCase();
        if (lang === 'zh' || lang === 'en') {
            await c.env.KV.put(`${CONSTANTS.TG_KV_PREFIX}:lang:${userId}`, lang);
            return await ctx.reply(`${msgs.TgLangSetSuccessMsg} ${lang === 'zh' ? '中文' : 'English'}`);
        }

        const currentLang = await c.env.KV.get(`${CONSTANTS.TG_KV_PREFIX}:lang:${userId}`);
        return await ctx.reply(
            `${msgs.TgCurrentLangMsg} ${currentLang || 'auto'}\n`
            + `${msgs.TgSelectLangMsg}\n`
            + `/lang zh - 中文\n`
            + `/lang en - English`
        );
    });

    const queryMail = async (ctx: TgContext, queryAddress: string, mailIndex: number, edit: boolean) => {
        const msgs = await getTgMessages(c, ctx);
        const userId = ctx?.message?.from?.id || ctx.callbackQuery?.message?.chat?.id;
        if (!userId) {
            return await ctx.reply(msgs.TgUnableGetUserInfoMsg);
        }
        // [自用定制] 管理员视角：未指定地址时默认查看全站最新邮件的邮箱
        if (!queryAddress) {
            const latest = await c.env.DB.prepare(
                `SELECT address FROM raw_mails ORDER BY id DESC LIMIT 1`
            ).first<string>("address");
            queryAddress = latest || "";
        }
        if (!queryAddress) {
            return await ctx.reply('📭 暂无任何邮件');
        }
        // 校验地址存在（TG 用户均为管理员，可查看任意邮箱，不再要求归属）
        const db_address_id = await c.env.DB.prepare(
            `SELECT id FROM address where name = ? `
        ).bind(queryAddress).first("id");
        if (!db_address_id) {
            return await ctx.reply(msgs.TgInvalidAddressMsg);
        }
        const mailRow = await c.env.DB.prepare(
            `SELECT * FROM raw_mails where address = ? `
            + ` order by id desc limit 1 offset ?`
        ).bind(
            queryAddress, mailIndex
        ).first<RawMailRow>();
        const raw = mailRow ? await resolveRawEmail(mailRow) : undefined;
        const mailId = mailRow?.id;
        const created_at = mailRow?.created_at;
        const { mail } = raw
            ? await parseMail(msgs, { rawEmail: raw }, queryAddress, created_at, mailRow?.metadata)
            : { mail: msgs.TgNoMoreMailsMsg };
        const settings = await c.env.KV.get<TelegramSettings>(CONSTANTS.TG_KV_SETTINGS_KEY, "json");
        const miniAppButtons = []
        if (settings?.miniAppUrl && settings?.miniAppUrl?.length > 0 && mailId) {
            const url = new URL(settings.miniAppUrl);
            url.pathname = "/telegram_mail"
            url.searchParams.set("mail_id", mailId);
            miniAppButtons.push(Markup.button.webApp(msgs.TgViewMailBtnMsg, url.toString()));
        }
        if (edit) {
            return await ctx.editMessageText(mail || msgs.TgNoMailMsg,
                {
                    ...Markup.inlineKeyboard([
                        Markup.button.callback(msgs.TgPrevBtnMsg, `mail_${queryAddress}_${mailIndex - 1}`, mailIndex <= 0),
                        ...miniAppButtons,
                        Markup.button.callback(msgs.TgNextBtnMsg, `mail_${queryAddress}_${mailIndex + 1}`, !raw),
                        backToMenuButton(),
                    ])
                },
            );
        }
        return await ctx.reply(mail || msgs.TgNoMailMsg,
            {
                ...Markup.inlineKeyboard([
                    Markup.button.callback(msgs.TgPrevBtnMsg, `mail_${queryAddress}_${mailIndex - 1}`, mailIndex <= 0),
                    ...miniAppButtons,
                    Markup.button.callback(msgs.TgNextBtnMsg, `mail_${queryAddress}_${mailIndex + 1}`, !raw),
                    backToMenuButton(),
                ])
            },
        );
    }

    bot.command("mails", async ctx => {
        const msgs = await getTgMessages(c, ctx);
        try {
            const queryAddress = ctx?.message?.text.slice("/mails".length).trim();
            return await queryMail(ctx, queryAddress, 0, false);
        } catch (e) {
            return await ctx.reply(`${msgs.TgGetMailFailedMsg} ${(e as Error).message}`);
        }
    });

    // [自用定制] Inline 键盘菜单：主菜单/二级子菜单回调分发
    // 管理员视角：列出全站所有邮箱（分页，每页 10 条）
    const renderAddressList = async (ctx: TgContext, msgs: LocaleMessages, offset: number = 0): Promise<void> => {
        const pageSize = 10;
        const totalRow = await c.env.DB.prepare(
            `SELECT COUNT(*) as cnt FROM address`
        ).first<{ cnt: number }>();
        const total = totalRow?.cnt || 0;
        const rows = await c.env.DB.prepare(
            `SELECT id, name FROM address ORDER BY id DESC LIMIT ? OFFSET ?`
        ).bind(pageSize, offset).all<{ id: number; name: string }>();
        const lines = (rows.results || []).map((r, i) => `${offset + i + 1}. ${r.name}`).join("\n");
        const keyboardRows: ReturnType<typeof Markup.button.callback>[][] = [];
        for (const r of rows.results || []) {
            keyboardRows.push([
                Markup.button.callback('📬 查看', `v${r.id}`),
                Markup.button.callback('🗑 删除', `d${r.id}`),
            ]);
        }
        const navRow: ReturnType<typeof Markup.button.callback>[] = [];
        if (offset > 0) {
            navRow.push(Markup.button.callback('⬅️ 上一页', `btn:list:p${Math.max(0, offset - pageSize)}`));
        }
        if (offset + pageSize < total) {
            navRow.push(Markup.button.callback('下一页 ➡️', `btn:list:p${offset + pageSize}`));
        }
        if (navRow.length) keyboardRows.push(navRow);
        keyboardRows.push([Markup.button.callback('📮 新建邮箱', 'btn:new'), backToMenuButton()]);
        const start = total === 0 ? 0 : offset + 1;
        const end = Math.min(offset + pageSize, total);
        const text = `📋 全部邮箱列表（共 ${total} 个${total > 0 ? `，显示 ${start}-${end}` : ''}）：\n\n`
            + (lines || '（暂无邮箱，点下方按钮新建）');
        await ctx.editMessageText(text, { ...Markup.inlineKeyboard(keyboardRows) });
    };

    bot.on(callbackQuery("data"), async ctx => {
        const msgs = await getTgMessages(c, ctx);
        try {
            const data = ctx.callbackQuery.data;
            const userId = ctx.callbackQuery?.from?.id?.toString();
            if (!data || !userId) {
                return await ctx.answerCbQuery(msgs.TgUnableGetUserInfoMsg);
            }
            // 主菜单：新建邮箱
            if (data === "btn:new") {
                try {
                    const res = await tgUserNewAddress(c, userId, "", msgs);
                    await ctx.editMessageText(
                        `${msgs.TgCreateSuccessMsg}\n`
                        + `${msgs.TgAddressMsg} ${res.address}\n`
                        + (res.password ? `${msgs.TgPasswordMsg} \`${res.password}\`\n` : '')
                        + `${msgs.TgCredentialMsg} \`${res.jwt}\``,
                        { ...Markup.inlineKeyboard([[backToMenuButton()]]), parse_mode: "Markdown" }
                    );
                } catch (e) {
                    await ctx.editMessageText(`${msgs.TgCreateFailedMsg} ${(e as Error).message}`,
                        { ...Markup.inlineKeyboard([[backToMenuButton()]]) });
                }
                return await ctx.answerCbQuery();
            }
            // 主菜单：邮箱列表（二级子菜单，全站管理员视角）
            if (data === "btn:list") {
                await renderAddressList(ctx, msgs, 0);
                return await ctx.answerCbQuery();
            }
            // 列表分页
            if (data.startsWith("btn:list:p")) {
                const offset = parseInt(data.slice("btn:list:p".length) || "0", 10) || 0;
                await renderAddressList(ctx, msgs, offset);
                return await ctx.answerCbQuery();
            }
            // 主菜单：最新邮件
            if (data === "btn:inbox") {
                await queryMail(ctx, "", 0, true);
                return await ctx.answerCbQuery();
            }
            // 返回主菜单
            if (data === "btn:menu") {
                await ctx.editMessageText(
                    `${msgs.TgWelcomeMsg}\n\n${msgs.TgAvailableCommandsMsg}`,
                    { ...mainMenuKeyboard() }
                );
                return await ctx.answerCbQuery();
            }
            // 二级子菜单：查看 / 删除指定邮箱（v<id> / d<id>，管理员可操作全站任意邮箱）
            if (data.startsWith("v") || data.startsWith("d")) {
                const action = data[0];
                const addressId = data.slice(1);
                const row = await c.env.DB.prepare(
                    `SELECT name FROM address WHERE id = ?`
                ).bind(addressId).first<{ name: string }>();
                if (!row?.name) {
                    return await ctx.answerCbQuery(msgs.TgInvalidAddressMsg);
                }
                const address = row.name;
                if (action === "v") {
                    await queryMail(ctx, address, 0, true);
                } else {
                    await deleteAddressWithData(c, null, addressId);
                    await ctx.editMessageText(`${msgs.TgDeleteSuccessMsg} ${address}`);
                    await renderAddressList(ctx, msgs, 0);
                }
                return await ctx.answerCbQuery();
            }
            // 原有翻页回调
            if (data.startsWith("mail_") && data.split("_").length === 3) {
                const [_, queryAddress, mailIndex] = data.split("_");
                await queryMail(ctx, queryAddress, parseInt(mailIndex), true);
                return await ctx.answerCbQuery();
            }
            return await ctx.answerCbQuery();
        }
        catch (e) {
            console.log(`${msgs.TgGetMailFailedMsg} ${(e as Error).message}`, e);
            return await ctx.answerCbQuery(`${msgs.TgGetMailFailedMsg} ${(e as Error).message}`);
        }
    });

    return bot;
}


export async function initTelegramBotCommands(c: Context<HonoCustomType>, bot: Telegraf) {
    await bot.telegram.setMyCommands(getTelegramCommands(c));
}

const parseMail = async (
    msgs: LocaleMessages,
    parsedEmailContext: ParsedEmailContext,
    address: string,
    created_at: string | undefined | null,
    aiExtract?: ExtractResult | string | null
) => {
    if (!parsedEmailContext.rawEmail) {
        return {};
    }
    try {
        const parsedEmail = await commonParseMail(parsedEmailContext);
        let parsedText = parsedEmail?.text || "";
        if (!parsedText.trim() && parsedEmail?.html) {
            parsedText = htmlToText(parsedEmail.html);
        }
        if (parsedText.length && parsedText.length > 1000) {
            parsedText = parsedText.substring(0, 1000) + `\n\n...\n${msgs.TgMsgTooLongMsg}`;
        }
        return {
            isHtml: false,
            mail: formatAiExtractForTelegram(msgs, aiExtract)
                + `From: ${parsedEmail?.sender || msgs.TgNoSenderMsg}\n`
                + `To: ${address}\n`
                + (created_at ? `Date: ${created_at}\n` : "")
                + `Subject: ${parsedEmail?.subject}\n`
                + `Content:\n${parsedText || msgs.TgParseFailedViewInAppMsg}`
        };
    } catch (e) {
        return {
            isHtml: false,
            mail: `${msgs.TgParseMailFailedMsg} ${(e as Error).message}`
        };
    }
}


export async function sendMailToTelegram(
    c: Context<HonoCustomType>, address: string,
    parsedEmailContext: ParsedEmailContext,
    message_id: string | null,
    aiExtract?: ExtractResult | null
) {
    if (!c.env.TELEGRAM_BOT_TOKEN || !c.env.KV) {
        return;
    }
    const userId = await c.env.KV.get(`${CONSTANTS.TG_KV_PREFIX}:${address}`);
    const settings = await c.env.KV.get<TelegramSettings>(CONSTANTS.TG_KV_SETTINGS_KEY, "json");
    const globalPush = settings?.enableGlobalMailPush && settings?.globalMailPushList;
    if (!userId && !globalPush) {
        return;
    }
    const mailId = await c.env.DB.prepare(
        `SELECT id FROM raw_mails where address = ? and message_id = ?`
    ).bind(address, message_id).first<string>("id");
    const bot = newTelegramBot(c, c.env.TELEGRAM_BOT_TOKEN);

    const buildAndSend = async (targetUserId: string, msgs: LocaleMessages) => {
        const { mail } = await parseMail(
            msgs, parsedEmailContext, address, new Date().toUTCString(), aiExtract
        );
        if (!mail) return;
        const attachments = parsedEmailContext.parsedEmail?.attachments || [];
        const buttons = [];
        if (settings?.miniAppUrl && mailId) {
            const url = new URL(settings.miniAppUrl);
            url.pathname = "/telegram_mail"
            url.searchParams.set("mail_id", mailId);
            buttons.push(Markup.button.webApp(msgs.TgViewMailBtnMsg, url.toString()));
        }
        await bot.telegram.sendMessage(targetUserId, mail, {
            ...Markup.inlineKeyboard([...buttons])
        });
        // send attachments via native fetch (telegraf multipart upload is incompatible with CF Workers)
        if (getBooleanValue(c.env.ENABLE_TG_PUSH_ATTACHMENT) && attachments.length > 0) {
            const caption = `From: ${parsedEmailContext.parsedEmail?.sender || ""}\nSubject: ${parsedEmailContext.parsedEmail?.subject || ""}`;
            await sendTelegramAttachments(c.env.TELEGRAM_BOT_TOKEN, targetUserId, attachments, caption);
        }
    };

    if (globalPush) {
        const globalMsgs = i18n.getMessages(c.env.DEFAULT_LANG || 'zh');
        for (const pushId of settings.globalMailPushList) {
            await buildAndSend(pushId, globalMsgs);
        }
    }

    if (userId) {
        const userMsgs = await getTgMessages(c, undefined, userId);
        await buildAndSend(userId, userMsgs);
    }
}
