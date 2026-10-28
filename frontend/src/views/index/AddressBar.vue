<script setup>
import { onMounted, ref } from 'vue'
import { useScopedI18n } from '@/i18n/app'
import { ExchangeAlt } from '@vicons/fa'

import { useGlobalState } from '../../store'
import { api } from '../../api'
import UserLogin from '../user/UserLogin.vue'
import TelegramAddress from './TelegramAddress.vue'
import AddressManagement from '../user/AddressManagement.vue'
import AddressSelect from '../../components/AddressSelect.vue'
import AddressCredentialModal from '../../components/AddressCredentialModal.vue'

const {
    jwt, settings, showAddressCredential, userJwt,
    isTelegram, addressPassword
} = useGlobalState()

const { t } = useScopedI18n('views.index.AddressBar')

const showAddressManage = ref(false)

onMounted(async () => {
    await api.getSettings();
});
</script>

<template>
    <div>
        <n-card :bordered="false" embedded v-if="!settings.fetched">
            <n-skeleton style="height: 50vh" />
        </n-card>
        <div v-else-if="settings.address">
            <n-alert type="info" :show-icon="false" :bordered="false">
                <AddressSelect>
                    <template #actions>
                        <n-button class="address-manage" size="small" tertiary type="primary"
                            @click="showAddressManage = true">
                            <n-icon :component="ExchangeAlt" />
                            {{ t('addressManage') }}
                        </n-button>
                    </template>
                </AddressSelect>
            </n-alert>
        </div>
        <div v-else-if="isTelegram">
            <TelegramAddress />
        </div>
        <div v-else-if="userJwt" class="center">
            <n-card :bordered="false" embedded style="max-width: 900px; width: 100%;">
                <AddressManagement />
            </n-card>
        </div>
        <div v-else class="center">
            <n-card :bordered="false" embedded style="max-width: 600px;">
                <n-alert v-if="jwt" type="warning" :show-icon="false" :bordered="false" closable>
                    <span>{{ t('fetchAddressError') }}</span>
                </n-alert>
                <!-- [自用定制] 不再提供匿名凭证登录/匿名新建邮箱，统一走账户密码登录 -->
                <UserLogin />
            </n-card>
        </div>
        <AddressCredentialModal v-model:show="showAddressCredential" :address="settings.address" :jwt="jwt"
            :address-password="addressPassword" />
        <n-modal v-model:show="showAddressManage" preset="card" :title="t('addressManage')"
            style="width: 720px;">
            <TelegramAddress v-if="isTelegram" />
            <AddressManagement v-else-if="userJwt" />
            <UserLogin v-else />
        </n-modal>
    </div>
</template>

<style scoped>
.n-alert {
    margin-top: 10px;
    margin-bottom: 10px;
    text-align: center;
}

.n-card {
    margin-top: 10px;
}

.center {
    display: flex;
    text-align: left;
    place-items: center;
    justify-content: center;
    margin: 20px;
}

.address-manage {
    flex: 0 0 auto;
    white-space: nowrap;
}

</style>
