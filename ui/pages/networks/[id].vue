<script setup>
const route = useRoute();
const network = route.params.id;
const app = {
  selectedNetwork: {
    key: network,
    name: network,
    rpc: [],
    explorer: {
      url: '',
      name: ''
    },
    logo: ''
  }
};

const selectNetwork = network => {
  console.log(network);
};

const editNetworkButtonClick = () => {
  console.log('editNetworkButtonClick');
};

const editNetworksJSONButtonClick = () => {
  console.log('editNetworksJSONButtonClick');
};

const imageCopy = () => {
  console.log('imageCopy');
};
</script>

<template>
  <div v-if="app.selectedNetwork" id="networkTester" class="mt-4 p-2 bg-white">
    <div class="lg:flex lg:items-center lg:justify-between mb-4">
      <div class="flex-1 flex min-w-0">
        <NetworkLogo :network="network" />
        <div class="mt-1">
          <h2 class="text-3xl">
            {{ app.selectedNetwork.name }}
            <span
              v-if="app.selectedNetwork"
              class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800 align-middle"
            >
              {{ app.selectedNetwork.key }}
            </span>
          </h2>
          <div>
            <div class="mt-2 flex items-center text-sm text-gray-500"></div>
          </div>
        </div>
      </div>
      <div class="flex">
        <button
          type="button"
          class="items-center px-4 py-2 mx-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          @click="editNetworkButtonClick"
        >
          Edit Network
        </button>
        <button
          type="button"
          class="items-center px-4 py-2 mx-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          @click="editNetworksJSONButtonClick"
        >
          Edit networks.json
        </button>
        <button
          type="button"
          class="items-center px-4 py-2 mx-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          @click="selectNetwork(app.selectNetwork.key)"
        >
          Refresh
          <img
            class="inline w-4"
            alt="svgImg"
            src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHg9IjBweCIgeT0iMHB4Igp3aWR0aD0iMjQiIGhlaWdodD0iMjQiCnZpZXdCb3g9IjAgMCAxNzIgMTcyIgpzdHlsZT0iIGZpbGw6IzAwMDAwMDsiPjxnIGZpbGw9Im5vbmUiIGZpbGwtcnVsZT0ibm9uemVybyIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiIHN0cm9rZS1saW5lY2FwPSJidXR0IiBzdHJva2UtbGluZWpvaW49Im1pdGVyIiBzdHJva2UtbWl0ZXJsaW1pdD0iMTAiIHN0cm9rZS1kYXNoYXJyYXk9IiIgc3Ryb2tlLWRhc2hvZmZzZXQ9IjAiIGZvbnQtZmFtaWx5PSJub25lIiBmb250LXdlaWdodD0ibm9uZSIgZm9udC1zaXplPSJub25lIiB0ZXh0LWFuY2hvcj0ibm9uZSIgc3R5bGU9Im1peC1ibGVuZC1tb2RlOiBub3JtYWwiPjxwYXRoIGQ9Ik0wLDE3MnYtMTcyaDE3MnYxNzJ6IiBmaWxsPSJub25lIj48L3BhdGg+PGcgZmlsbD0iI2ZmZmZmZiI+PHBhdGggZD0iTTg2LDBsLTI4LjY2NjY3LDI4LjY2NjY3bDI4LjY2NjY3LDI4LjY2NjY3di0yMS41YzI3LjY1NjE3LDAgNTAuMTY2NjcsMjIuNTAzMzMgNTAuMTY2NjcsNTAuMTY2NjdjMCw2LjMwNjY3IC0xLjIyMzcxLDEyLjMyNzM0IC0zLjM1OTM3LDE3Ljg4ODY3bDEwLjg2MTk4LDEwLjg0Nzk4YzQuMzM1ODMsLTguNjY0NSA2LjgzMDczLC0xOC40MDIzMiA2LjgzMDczLC0yOC43MzY2NmMwLC0zNS41NjEgLTI4LjkzMTgzLC02NC41IC02NC41LC02NC41ek0yOC4zMzA3Myw1Ny4yNjMzNWMtNC4zMzU4Myw4LjY2NDUgLTYuODMwNzMsMTguNDAyMzIgLTYuODMwNzMsMjguNzM2NjVjMCwzNS41NjEgMjguOTMxODMsNjQuNSA2NC41LDY0LjV2MjEuNWwyOC42NjY2NywtMjguNjY2NjdsLTI4LjY2NjY3LC0yOC42NjY2N3YyMS41Yy0yNy42NTYxNywwIC01MC4xNjY2NywtMjIuNTAzMzMgLTUwLjE2NjY3LC01MC4xNjY2N2MwLC02LjMwNjY3IDEuMjIzNzEsLTEyLjMyNzM0IDMuMzU5MzgsLTE3Ljg4ODY3eiI+PC9wYXRoPjwvZz48L2c+PC9zdmc+"
          />
        </button>
        <button
          type="button"
          class="items-center px-4 py-2 mx-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium"
          @click="imageCopy()"
        >
          <img
            class="inline w-4"
            alt="copy icon"
            src="https://img.icons8.com/material-outlined/24/000000/copy.png"
          />
        </button>
      </div>
    </div>
    <div v-if="app.editNetwork">
      <h3>Edit Network Object</h3>
      <textarea
        v-model="app.newNetworkObject"
        class="form-textarea mt-1 block w-full input text-left p-2 border border-gray-300 rounded-md"
        rows="10"
        placeholder="Enter Network"
      ></textarea>
      <button
        type="button"
        class="px-4 py-2 my-2 mr-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        @click="app.editNetwork = false"
      >
        Cancel
      </button>
      <button
        type="button"
        class="px-4 py-2 my-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        @click="changeNetworksObject"
      >
        Apply
      </button>
    </div>
    <div v-if="app.error">ERROR: {{ app.error }}</div>
    <div class="flex flex-col mt-2">
      <div class="shadow overflow-hidden border-b border-gray-200 sm:rounded-lg">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th
                scope="col"
                class="px-6 py-1 pt-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                colspan="5"
              >
                Number of Nodes - {{ app.selectedNetwork.rpc.length }}
              </th>
            </tr>
            <tr>
              <th
                scope="col"
                class="px-6 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                RPC
              </th>
              <th
                scope="col"
                class="px-6 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                Latest Block
              </th>
              <th
                scope="col"
                class="px-6 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                Full archive node
              </th>
              <th
                scope="col"
                class="px-6 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                Multicall Avg. Time
              </th>
              <th
                scope="col"
                class="px-6 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                Node limit (max 10000 addresses)
              </th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            <tr v-for="(rpc, index) in app.selectedNetwork.rpcStatus" :key="index">
              <td class="p-2 border-b-1 border-gray-600">
                <div>
                  <div class="ml-4">
                    <div>
                      <img
                        class="w-4 cursor-pointer inline mr-2"
                        src="https://img.icons8.com/material-outlined/24/000000/copy.png"
                        @click="copy(rpc.url)"
                      />
                      <img
                        class="w-4 cursor-pointer inline mr-2"
                        src="
                              data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAABmJLR0QA/wD/AP+gvaeTAAAAZUlEQVRIiWNgGCmggYGB4T8a7iBGIyMWsf8UOgbFTCYKDSMbwIKBYvU09wGxFqC7kGgfDhofjFowasGoBRQAFiLVoRfr2Ip5rGDAgugplEavxXBhZD1EAT8GBoYnJFjwBKpnGAIAUcAmPA1WYN0AAAAASUVORK5CYII="
                        @click="
                          app.networks[app.selectedNetwork.key].rpc = app.networks[
                            app.selectedNetwork.key
                          ].rpc.filter(a => a !== rpc.url);
                          selectNetwork(app.selectedNetwork.key);
                        "
                      />
                      <h3
                        class="text-sm leading-6 font-medium text-gray-900"
                        style="width: 500px; overflow: hidden; text-overflow: ellipsis"
                      >
                        {{ rpc.url }}
                      </h3>
                    </div>
                  </div>
                </div>
              </td>
              <td
                v-if="rpc.status.loading"
                colspan="4"
                class="p-2 border-b-1 border-gray-600 text-center"
              >
                <div class="animate-pulse flex">
                  <div class="h-4 bg-blue-400 rounded w-5/6"></div>
                </div>
              </td>
              <td v-if="!rpc.status.loading" class="p-2 border-b-1 border-gray-600 text-center">
                <a
                  target="blank"
                  :href="`${app.selectedNetwork.explorer.url}/block/${rpc.status.latestBlockNumber}`"
                >
                  <h2 class="title-font font-medium text-2xl text-gray-900">
                    {{ rpc.status.latestBlockNumber }}
                  </h2>
                </a>
              </td>
              <td v-if="!rpc.status.loading" class="p-2 border-b-1 border-gray-600 text-center">
                <h2 class="title-font font-medium text-gray-900">
                  <div class="relative border-b-2 pb-1">
                    {{ rpc.status.fullArchiveNode }}
                    <div class="text-xs text-gray-400">1st block</div>
                  </div>
                  <div class="pt-1">
                    {{ rpc.status.fullArchiveNodeStart }}
                    <div class="text-xs text-gray-400">Start block</div>
                  </div>
                </h2>
              </td>
              <td v-if="!rpc.status.loading" class="p-2 border-b-1 border-gray-600 text-center">
                <h2 class="title-font font-medium text-2xl text-gray-900">
                  {{ rpc.status.multicall }}
                </h2>
              </td>
              <td v-if="!rpc.status.loading" class="p-2 border-b-1 border-gray-600 text-center">
                <div
                  v-if="
                    typeof rpc.status.nodeLimit === 'string' &&
                    rpc.status.nodeLimit.startsWith('checking')
                  "
                  class="title-font text-xs text-gray-600"
                >
                  {{ rpc.status.nodeLimit }}
                </div>
                <h2 v-else class="title-font font-medium text-2xl text-gray-900">
                  {{ rpc.status.nodeLimit }}
                </h2>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
