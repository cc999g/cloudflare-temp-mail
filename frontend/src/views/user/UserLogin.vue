<script setup>
import { useMessage } from 'naive-ui'
import { ref } from "vue";
import { useScopedI18n } from '@/i18n/app'
import { KeyFilled } from '@vicons/material'

import { api } from '../../api';
import { useGlobalState } from '../../store'
import { hashPassword } from '../../utils';
import { startAuthentication } from '@simplewebauthn/browser';

import Turnstile from '../../components/Turnstile.vue';

const {
    userJwt, userOpenSettings, openSettings,
    userOauth2SessionState, userOauth2SessionClientID
} = useGlobalState()
const message = useMessage();

const { t } = useScopedI18n('views.user.UserLogin')

// [自用定制] 已移除注册与找回密码入口：自助注册关闭，仅管理员可创建账户并设定密码。
const user = ref({
    email: "",
    password: ""
});
const loginCfToken = ref("")
const loginTurnstileRef = ref(null)

const emailLogin = async () => {
    if (!user.value.email || !user.value.password) {
        message.error(t('pleaseInput'));
        return;
    }
    try {
        const res = await api.fetch(`/user_api/login`, {
            method: "POST",
            body: JSON.stringify({
                email: user.value.email,
                // hash password
                password: await hashPassword(user.value.password),
                cf_token: loginCfToken.value
            })
        });
        userJwt.value = res.jwt;
        location.reload();
    } catch (error) {
        message.error(error.message || "login failed");
        loginTurnstileRef.value?.refresh?.();
    }
};

const passkeyLogin = async () => {
    try {
        const options = await api.fetch(`/user_api/passkey/authenticate_request`, {
            method: 'POST',
            body: JSON.stringify({
                domain: location.hostname,
            })
        })
        const credential = await startAuthentication({ optionsJSON: options })

        // Send the result to the server and return the promise.
        const res = await api.fetch(`/user_api/passkey/authenticate_response`, {
            method: 'POST',
            body: JSON.stringify({
                origin: location.origin,
                domain: location.hostname,
                credential
            })
        })
        userJwt.value = res.jwt;
        location.reload();
    } catch (e) {
        console.error(e)
        message.error(e.message)
    }
};

const oauth2Login = async (clientID) => {
    try {
        userOauth2SessionClientID.value = clientID;
        userOauth2SessionState.value = Math.random().toString(36).substring(2);
        const res = await api.fetch(`/user_api/oauth2/login_url?clientID=${clientID}&state=${userOauth2SessionState.value}`);
        // redirect to oauth2 login page
        location.href = res.url;
    } catch (error) {
        message.error(error.message || "login failed");
    }
};
</script>

<template>
    <div class="center">
        <n-form v-if="userOpenSettings.fetched">
            <n-form-item-row :label="t('email')" required>
                <n-input v-model:value="user.email" />
            </n-form-item-row>
            <n-form-item-row :label="t('password')" required>
                <n-input v-model:value="user.password" type="password" show-password-on="click"
                    @keyup.enter="emailLogin" />
            </n-form-item-row>
            <Turnstile ref="loginTurnstileRef" v-if="openSettings.enableGlobalTurnstileCheck" v-model:value="loginCfToken" />
            <n-button @click="emailLogin" type="primary" block secondary strong>
                {{ t('login') }}
            </n-button>
            <n-divider />
            <n-button @click="passkeyLogin" type="primary" block secondary strong>
                <template #icon>
                    <n-icon :component="KeyFilled" />
                </template>
                {{ t('loginWithPasskey') }}
            </n-button>
            <n-button @click="oauth2Login(item.clientID)" v-for="item in userOpenSettings.oauth2ClientIDs"
                :key="item.clientID" block secondary strong>
                <template #icon v-if="item.icon">
                    <span class="oauth2-icon" v-html="item.icon"></span>
                </template>
                {{ t('loginWith', { provider: item.name }) }}
            </n-button>
        </n-form>
    </div>
</template>

<style scoped>
.center {
    display: flex;
    text-align: center;
    place-items: center;
    justify-content: center;
}

.n-button {
    margin-top: 10px;
}

.oauth2-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
}

.oauth2-icon :deep(svg) {
    width: 100%;
    height: 100%;
}
</style>
