<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <!-- Global toast host: vue-sonner, client-only (auto-registered by the
       `vue-sonner/nuxt` module). Replaces the old per-layout <UiAppToast>
       in-page element; pages fire toasts via useToast(). -->
  <Toaster position="top-right" theme="dark" rich-colors close-button />
</template>
