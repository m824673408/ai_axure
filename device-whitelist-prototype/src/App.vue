<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type TableInstance } from 'element-plus'
import { CircleCheck, CopyDocument, Delete, Monitor, Plus, Search } from '@element-plus/icons-vue'

type System = 'iOS' | 'Android'
type DataState = '已清空' | '有待清理数据'

interface Device {
  id: string
  alias: string
  system: System
  dataState: DataState
  updatedAt: string
}

const devices = ref<Device[]>([
  { id: '9426766F-472B-4EFC-ABAF-D02E7C2C6363', alias: '奇克斯 · iPhone 15', system: 'iOS', dataState: '有待清理数据', updatedAt: '今天 10:42' },
  { id: 'DCF5C19D-E617-4B19-8C00-2C3E07D6668A', alias: '联调机 A03 · Pixel 8', system: 'Android', dataState: '已清空', updatedAt: '昨天 18:20' },
  { id: 'EEA5D09E-2C07-4DA4-94B1-D45A0846D296', alias: '回归机 · iPhone 14 Pro', system: 'iOS', dataState: '有待清理数据', updatedAt: '8 月 19 日' },
  { id: '0F7ACB43-CB9A-4D52-9E3E-97B4B881E178', alias: '测试设备 · Redmi K70', system: 'Android', dataState: '已清空', updatedAt: '8 月 18 日' },
])

const query = ref('')
const system = ref<'全部' | System>('全部')
const selectedDevices = ref<Device[]>([])
const addDialogVisible = ref(false)
const formRef = ref<FormInstance>()
const tableRef = ref<TableInstance>()
const newDevice = ref({ alias: '', id: '', system: 'iOS' as System })

const filteredDevices = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  return devices.value.filter((device) => {
    const matchesSystem = system.value === '全部' || device.system === system.value
    const matchesKeyword = !keyword || `${device.id} ${device.alias}`.toLowerCase().includes(keyword)
    return matchesSystem && matchesKeyword
  })
})

const dirtyCount = computed(() => devices.value.filter((device) => device.dataState === '有待清理数据').length)

function showAddDialog() {
  newDevice.value = { alias: '', id: '', system: 'iOS' }
  addDialogVisible.value = true
  nextTick(() => formRef.value?.clearValidate())
}

function addDevice() {
  const id = newDevice.value.id.trim().toUpperCase()
  const alias = newDevice.value.alias.trim()
  if (!id || !alias) return
  if (devices.value.some((device) => device.id === id)) {
    ElMessage.warning('该 Client ID 已在白名单中')
    return
  }
  devices.value.unshift({ id, alias, system: newDevice.value.system, dataState: '有待清理数据', updatedAt: '刚刚' })
  addDialogVisible.value = false
  ElMessage.success('设备已加入白名单')
}

async function clearDevices(targets: Device[]) {
  if (!targets.length) return
  try {
    await ElMessageBox.confirm(
      `将清空 ${targets.length} 台设备的测试归因数据，设备会继续保留在白名单中。此原型不会调用或删除真实数据。`,
      targets.length === 1 ? '清空设备数据？' : `清空 ${targets.length} 台设备的数据？`,
      { confirmButtonText: '确认清空', cancelButtonText: '取消', type: 'warning', draggable: true },
    )
  } catch {
    return
  }
  const ids = new Set(targets.map((device) => device.id))
  devices.value = devices.value.map((device) => ids.has(device.id) ? { ...device, dataState: '已清空', updatedAt: '刚刚' } : device)
  tableRef.value?.clearSelection()
  ElMessage.success(`已完成 ${targets.length} 台设备的数据清空模拟`)
}

async function removeDevice(device: Device) {
  try {
    await ElMessageBox.confirm(`将“${device.alias}”移出当前产品的联调白名单。`, '移出白名单？', {
      confirmButtonText: '确认移出', cancelButtonText: '取消', type: 'warning',
    })
  } catch {
    return
  }
  devices.value = devices.value.filter((item) => item.id !== device.id)
  ElMessage.success('设备已移出白名单')
}

async function copyId(id: string) {
  try {
    await navigator.clipboard.writeText(id)
    ElMessage.success('Client ID 已复制')
  } catch {
    ElMessage.warning('复制失败，请手动复制')
  }
}

function shortId(id: string) {
  return `${id.slice(0, 8)}…${id.slice(-4)}`
}
</script>

<template>
  <el-container class="app-shell">
    <el-header class="app-header">
      <div class="header-content">
        <div class="brand"><el-icon><Monitor /></el-icon><span>联调设备</span></div>
        <el-tag class="environment" type="success" effect="light" round>测试环境</el-tag>
        <el-avatar :size="30" class="user-avatar">姜</el-avatar>
      </div>
    </el-header>

    <el-main class="app-main">
      <div class="page-title-row">
        <div>
          <el-breadcrumb separator="/" class="breadcrumb"><el-breadcrumb-item>设备管理</el-breadcrumb-item><el-breadcrumb-item>白名单</el-breadcrumb-item></el-breadcrumb>
          <h1>归因联调设备白名单</h1>
          <p>登记用于归因联调的测试设备。清空操作仅影响该设备的测试归因数据。</p>
        </div>
        <el-button text type="primary">使用说明</el-button>
      </div>

      <el-card shadow="never" class="project-card">
        <el-form inline>
          <el-form-item label="当前产品">
            <el-select model-value="黑子的篮球：街头对决" class="project-select" aria-label="当前产品">
              <el-option label="黑子的篮球：街头对决" value="黑子的篮球：街头对决" />
            </el-select>
          </el-form-item>
          <span class="project-tip"><el-icon><CircleCheck /></el-icon>仅白名单内设备可参与归因联调</span>
        </el-form>
      </el-card>

      <el-row :gutter="16" class="stat-row">
        <el-col :xs="24" :sm="12" :md="8"><el-card shadow="never" class="stat-card"><el-statistic title="已登记设备" :value="devices.length" /></el-card></el-col>
        <el-col :xs="24" :sm="12" :md="8"><el-card shadow="never" class="stat-card warning-stat"><el-statistic title="待清理设备数据" :value="dirtyCount" /></el-card></el-col>
        <el-col :xs="24" :md="8" class="stat-note"><el-icon><CircleCheck /></el-icon>清空数据不会移出白名单，设备可继续联调。</el-col>
      </el-row>

      <el-card shadow="never" class="table-card">
        <template #header>
          <div class="card-header"><div><strong>白名单设备</strong><span>支持最多登记 100 台测试设备</span></div><el-button type="primary" :icon="Plus" @click="showAddDialog">添加设备</el-button></div>
        </template>
        <div class="toolbar">
          <div class="toolbar-filters">
            <el-input v-model="query" clearable :prefix-icon="Search" placeholder="搜索 Client ID 或设备备注" class="search-input" />
            <el-radio-group v-model="system" aria-label="设备系统"><el-radio-button value="全部">全部</el-radio-button><el-radio-button value="iOS">iOS</el-radio-button><el-radio-button value="Android">Android</el-radio-button></el-radio-group>
          </div>
          <el-button type="danger" plain :icon="Delete" :disabled="!selectedDevices.length" @click="clearDevices(selectedDevices)">清空所选数据<span v-if="selectedDevices.length">（{{ selectedDevices.length }}）</span></el-button>
        </div>
        <el-table ref="tableRef" :data="filteredDevices" row-key="id" class="device-table" @selection-change="selectedDevices = $event">
          <el-table-column type="selection" width="52" />
          <el-table-column label="设备 / Client ID" min-width="285"><template #default="{ row }"><div class="device-name">{{ row.alias }}</div><el-button text size="small" :icon="CopyDocument" class="client-id" @click="copyId(row.id)">{{ shortId(row.id) }}</el-button></template></el-table-column>
          <el-table-column label="系统" width="110"><template #default="{ row }"><el-tag size="small" :type="row.system === 'iOS' ? 'primary' : 'success'" effect="light">{{ row.system }}</el-tag></template></el-table-column>
          <el-table-column label="数据状态" width="160"><template #default="{ row }"><el-tag size="small" :type="row.dataState === '已清空' ? 'success' : 'warning'" effect="plain">{{ row.dataState }}</el-tag></template></el-table-column>
          <el-table-column prop="updatedAt" label="最近更新" width="130" />
          <el-table-column label="操作" width="160" fixed="right"><template #default="{ row }"><el-button text type="primary" size="small" :disabled="row.dataState === '已清空'" @click="clearDevices([row])">清空数据</el-button><el-button text type="danger" size="small" @click="removeDevice(row)">移出</el-button></template></el-table-column>
          <template #empty><el-empty description="没有找到匹配的设备" /></template>
        </el-table>
      </el-card>
    </el-main>
  </el-container>

  <el-dialog v-model="addDialogVisible" title="添加联调设备" width="480px" destroy-on-close>
    <p class="dialog-intro">设备加入后即可参与当前产品的归因联调。</p>
    <el-form ref="formRef" :model="newDevice" label-position="top">
      <el-form-item label="设备备注" required><el-input v-model="newDevice.alias" maxlength="40" placeholder="例如：回归机 · iPhone 15" /></el-form-item>
      <el-form-item label="Client ID" required><el-input v-model="newDevice.id" placeholder="输入设备 Client ID" /></el-form-item>
      <el-form-item label="设备系统"><el-select v-model="newDevice.system"><el-option label="iOS" value="iOS" /><el-option label="Android" value="Android" /></el-select></el-form-item>
      <el-alert title="添加前请确认设备 Client ID 与联调环境一致。" type="info" :closable="false" show-icon />
    </el-form>
    <template #footer><el-button @click="addDialogVisible = false">取消</el-button><el-button type="primary" @click="addDevice">加入白名单</el-button></template>
  </el-dialog>
</template>
