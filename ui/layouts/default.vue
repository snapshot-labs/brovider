<script setup>
const app = {
  networks: [
    {
      key: '1',
      name: 'Ethereum Mainnet'
    },
    {
      key: '4',
      name: 'Ethereum Rinkeby'
    },
    {
      key: '100',
      name: 'xDai'
    },
    {
      key: '137',
      name: 'Polygon'
    },
    {
      key: '250',
      name: 'Fantom'
    },
    {
      key: '42161',
      name: 'Arbitrum'
    },
    {
      key: '43114',
      name: 'Avalanche'
    },
    {
      key: '80001',
      name: 'Mumbai'
    },
    {
      key: '421611',
      name: 'Arbitrum Testnet'
    },
    {
      key: '43113',
      name: 'Fuji'
    },
    {
      key: '1287',
      name: 'Moonbase Alpha'
    },
    {
      key: '1284',
      name: 'Moonbeam Testnet'
    },
    {
      key: '1285',
      name: 'Moonriver Testnet'
    },
    {
      key: '1286',
      name: 'Moonrock Testnet'
    },
    {
      key: '1281',
      name: 'Moonbase Testnet'
    },
    {
      key: '1283',
      name: 'Moonbeam'
    },
    {
      key: '1282',
      name: 'Moonriver'
    },
    {
      key: '1280',
      name: 'Moonbase Alpha Testnet'
    },
    {
      key: '256',
      name: 'Huobi ECO Chain'
    },
    {
      key: '1288',
      name: 'Moonrock'
    }
  ]
};
</script>

<template>
  <div class="flex font-sans bg-white">
    <div class="relative inline-block text-left w-60 shadow-md overflow-y-scroll h-screen">
      <div class="sticky top-0 z-10 bg-white">
        <div class="py-5 flex justify-center border-b">
          <nuxt-link to="/networks">
            <img
              class="inline w-6"
              src="https://raw.githubusercontent.com/snapshot-labs/brand/master/icon/icon.svg"
            />
            <h2
              class="inline text-xl tracking-tight font-semi-bold text-gray-900 ml-2 align-middle"
            >
              Networks
            </h2>
          </nuxt-link>
        </div>
      </div>
      <ul>
        <li v-for="(item, index) in Object.values(app.networks)" :key="index" class="relative">
          <nuxt-link :to="{ name: 'networks-id', params: { id: item.key } }">
            <div
              :class="`flex hover:bg-purple-500 hover:text-white p-2 pl-2 border-b-2 ${
                $route.params.id === item.key ? ' bg-purple-700 text-white' : 'text-gray-700'
              }`"
            >
              <div>
                <span
                  class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800"
                >
                  {{ item.key }}
                </span>
              </div>
              <div id="menu-item-0" class="px-2 py-1 text-sm" role="menuitem" tabindex="-1">
                {{ item.name }}
              </div>
            </div>
          </nuxt-link>
        </li>
      </ul>
    </div>
    <div class="flex-auto p-4">
      <slot />
    </div>
  </div>
</template>
