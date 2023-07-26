import Icons from 'unplugin-icons/vite';
import IconsResolver from 'unplugin-icons/resolver';
import Components from 'unplugin-vue-components/vite';

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  devtools: {
    enabled: true
  },
  ssr: false,
  typescript: {
    shim: false
  },
  app: {
    head: {
      title: 'Brovider'
    }
  },
  modules: [
    '@nuxtjs/eslint-module',
    '@nuxtjs/tailwindcss',
    'nuxt-headlessui',
    '@vueuse/nuxt',
    'nuxt-lodash',
    ['unplugin-icons/nuxt', {}]
  ],
  tailwindcss: {
    cssPath: '~/assets/css/style.scss',
    configPath: 'tailwind.config.js'
  },
  eslint: {
    fix: true,
    lintOnStart: false,
    ignorePath: '.gitignore'
  },
  vite: {
    plugins: [
      Components({
        resolvers: [IconsResolver()]
      }),
      Icons()
    ]
  }
});
