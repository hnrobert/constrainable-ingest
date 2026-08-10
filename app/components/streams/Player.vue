<script setup lang="ts">
import type mpegtsTypes from 'mpegts.js'

// Admin live player. Plays a single live stream by name; URLs come from the
// admin-only /api/streams/url endpoint. Browser connects to SRS directly.
const props = defineProps<{ streamName: string }>()

type Mode = 'flv' | 'webrtc'
const mode = ref<Mode>('flv')
const videoEl = ref<HTMLVideoElement | null>(null)
const status = ref<'idle' | 'loading' | 'playing' | 'error'>('idle')
const errorMsg = ref('')
const urls = ref<{ flv: string; whep: string } | null>(null)

let mpegPlayer: mpegtsTypes.Player | null = null
let pc: RTCPeerConnection | null = null

async function resolveUrls(): Promise<void> {
  status.value = 'loading'
  try {
    urls.value = await $fetch<{ flv: string; whep: string }>('/api/streams/url', {
      params: { streamName: props.streamName },
    })
  } catch (e: any) {
    status.value = 'error'
    errorMsg.value = e?.data?.statusMessage || e?.message || '无法获取播放地址'
  }
}

function teardown(): void {
  if (mpegPlayer) {
    try {
      mpegPlayer.pause()
      mpegPlayer.unload()
      mpegPlayer.detachMediaElement()
      mpegPlayer.destroy()
    } catch {
      /* ignore */
    }
    mpegPlayer = null
  }
  if (pc) {
    try {
      pc.getSenders().forEach((s) => s.track?.stop())
      pc.close()
    } catch {
      /* ignore */
    }
    pc = null
  }
  if (videoEl.value) videoEl.value.srcObject = null
}

async function startFlv(): Promise<void> {
  teardown()
  if (!urls.value) return
  status.value = 'loading'
  errorMsg.value = ''
  try {
    const mpegts = (await import('mpegts.js')).default
    mpegPlayer = mpegts.createPlayer(
      { type: 'flv', isLive: true, url: urls.value.flv },
      { enableStashBuffer: false, stashInitialSize: 128 },
    )
    mpegPlayer.on(mpegts.Events.ERROR, (errType, errDetail) => {
      status.value = 'error'
      errorMsg.value = `FLV 错误：${errType} ${errDetail ?? ''}`
    })
    mpegPlayer.attachMediaElement(videoEl.value!)
    mpegPlayer.load()
    await mpegPlayer.play()
    status.value = 'playing'
  } catch (e: any) {
    status.value = 'error'
    errorMsg.value = 'FLV 播放失败：' + (e?.message ?? String(e))
  }
}

async function startWebrtc(): Promise<void> {
  teardown()
  if (!urls.value || !videoEl.value) return
  status.value = 'loading'
  errorMsg.value = ''
  try {
    pc = new RTCPeerConnection()
    pc.addTransceiver('video', { direction: 'recvonly' })
    pc.addTransceiver('audio', { direction: 'recvonly' })
    pc.ontrack = (e) => {
      videoEl.value!.srcObject = e.streams[0] ?? null
      videoEl.value!.play().catch(() => {})
    }
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    const resp = await fetch(urls.value.whep, {
      method: 'POST',
      headers: { 'content-type': 'application/sdp' },
      body: offer.sdp,
    })
    if (!resp.ok) throw new Error(`WHEP ${resp.status}`)
    const answerSdp = await resp.text()
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })
    status.value = 'playing'
  } catch (e: any) {
    status.value = 'error'
    errorMsg.value = 'WebRTC 失败，可切回 FLV：' + (e?.message ?? String(e))
  }
}

async function switchMode(m: Mode): Promise<void> {
  mode.value = m
  if (m === 'flv') await startFlv()
  else await startWebrtc()
}

onMounted(async () => {
  await resolveUrls()
  if (urls.value) await startFlv()
})

onBeforeUnmount(teardown)

watch(
  () => props.streamName,
  async () => {
    await resolveUrls()
    if (urls.value) await (mode.value === 'flv' ? startFlv() : startWebrtc())
  },
)
</script>

<template>
  <div class="player card">
    <div class="bar between">
      <span class="badge mono">{{ props.streamName }}</span>
      <span class="badge" :class="{
        ok: status === 'playing',
        warn: status === 'loading',
        danger: status === 'error',
        muted: status === 'idle',
      }">
        {{ status === 'playing' ? '播放中' : status === 'loading' ? '加载中…' : status === 'error' ? '错误' : '空闲' }}
      </span>
      <div class="modes">
        <button :class="{ primary: mode === 'flv' }" @click="switchMode('flv')">FLV</button>
        <button :class="{ primary: mode === 'webrtc' }" @click="switchMode('webrtc')">WebRTC</button>
      </div>
    </div>
    <video ref="videoEl" class="video" autoplay muted playsinline controls />
    <p v-if="errorMsg" class="badge danger">{{ errorMsg }}</p>
    <p class="muted small">浏览器直连 SRS 播放。若 WebRTC 不通，请使用 FLV。</p>
  </div>
</template>

<style scoped>
.player { display: flex; flex-direction: column; gap: 0.5rem; }
.bar { flex-wrap: wrap; gap: 0.5rem; }
.modes { display: flex; gap: 0.4rem; margin-left: auto; }
.video { width: 100%; background: #000; border-radius: 8px; aspect-ratio: 16 / 9; }
.small { font-size: 0.78rem; }
.mono { font-family: ui-monospace, monospace; font-size: 0.82rem; }
</style>
