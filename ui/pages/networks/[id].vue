<script setup>
const route = useRoute();
const network = route.params.id;
const networkName = computed(() => getNetworkName(network));
const isRemoveModalOpen = ref(false);
const isEditModalOpen = ref(false);
const isViewModalOpen = ref(false);
const selectedNode = ref(null);

const nodes = computed(() => {
  return [
    {
      url: 'https://eth-mainnet.alchemyapi.io/v2/123',
      network: '1',
      provider: 'alchemy',
      requests: 0,
      errors: 0,
      duration: 0,
      archive: 0,
      multicall: '0xeefba1e63905ef1d7acba5a8513c70307c1ce441'
    },
    {
      url: 'https://eth-mainnet.alchemyapi.io/v2/123',
      network: '1',
      provider: 'alchemy',
      requests: 0,
      errors: 0,
      duration: 0,
      archive: -1,
      multicall: '0xeefba1e63905ef1d7acba5a8513c70307c1ce441'
    },
    {
      url: 'https://eth-mainnet.alchemyapi.io/v2/123',
      network: '1',
      provider: 'alchemy',
      requests: 0,
      errors: 0,
      duration: 0,
      archive: 1,
      multicall: '0xeefba1e63905ef1d7acba5a8513c70307c1ce441'
    }
  ];
});

const nodeParams = [
  {
    label: 'Provider',
    key: 'provider',
    default: 'n/a',
    classes: 'text-left'
  },
  {
    label: 'Requests',
    key: 'requests',
    default: 0,
    classes: 'text-center'
  },
  {
    label: 'Errors',
    key: 'errors',
    default: 0,
    classes: 'text-center'
  },
  {
    label: 'Mean duration',
    key: 'duration',
    default: 0,
    classes: 'text-center'
  },
  {
    label: 'type',
    key: 'archive',
    transform: value => {
      if (value === 1) {
        return 'archive';
      } else if (value === 0) {
        return 'light';
      } else {
        return 'n/a';
      }
    },
    classes: 'text-right'
  },
  {
    label: '',
    component: resolveComponent('NodeActionsDropdown'),
    componentListeners: {
      view: viewNodeDetails,
      edit: node => {
        isEditModalOpen.value = true;
        selectedNode.value = node;
      },
      remove: node => {
        isRemoveModalOpen.value = true;
        selectedNode.value = node;
      }
    },
    classes: 'text-right'
  }
];

function editNode() {
  isEditModalOpen.value = false;
}

function removeNode() {
  isRemoveModalOpen.value = false;
  console.log('remove node', selectedNode.value);
  selectedNode.value = null;
}

function viewNodeDetails(node) {
  selectedNode.value = node;
  isViewModalOpen.value = true;
}
</script>

<template>
  <div class="mt-4 p-2 bg-white">
    <div class="flex items-center justify-between mb-4">
      <div class="flex-1 flex min-w-0">
        <NetworkLogo :network="network" />
        <div class="mt-1">
          <h2 class="text-3xl">
            {{ networkName }}
            <span
              class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800 align-middle"
            >
              {{ network }}
            </span>
          </h2>
          <div>
            <div class="mt-2 flex items-center text-sm text-gray-500"></div>
          </div>
        </div>
      </div>

      <nuxt-link
        to="/networks"
        type="button"
        class="items-center px-4 py-2 mx-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
      >
        Add node
      </nuxt-link>
    </div>
    <div class="flex flex-col mt-2">
      <div class="shadow overflow-hidden border-b border-gray-200 sm:rounded-lg">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th
                scope="col"
                class="px-6 py-1 pt-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                :colspan="nodeParams.length"
              >
                Number of Nodes - {{ nodes.length }}
              </th>
            </tr>
            <tr>
              <th
                v-for="(param, index) in nodeParams"
                :key="index"
                scope="col"
                :class="param.classes"
                class="px-6 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {{ param.label }}
              </th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            <tr v-for="(node, index) in nodes" :key="index" @click="viewNodeDetails(node)">
              <td
                v-for="(param, cellIndex) in nodeParams"
                :key="cellIndex"
                class="py-2 px-6"
                :class="param.classes"
              >
                <component
                  :is="param.component"
                  v-if="param.component"
                  :item="node"
                  v-on="param.componentListeners || {}"
                />
                <div v-else>
                  <span v-if="param.transform">{{ param.transform(node[param.key]) }}</span>
                  <span v-else>{{ node[param.key] || param.default }}</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
  <ModalConfirmRemove v-model="isRemoveModalOpen" @confirm="removeNode()" />
  <ModalDetailsView v-model="isViewModalOpen" :node="selectedNode" />
</template>
