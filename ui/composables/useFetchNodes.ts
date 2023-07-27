type Node = {
  url: string;
  network: string;
  archive: boolean;
  requests: number;
  errors: number;
  duration: number;
  multicall: string;
  provider: string;
  created: number;
};

function useFetchNodes() {
  const nodes = ref([]) as Ref<Node[]>;
  const error = ref(null) as Ref<any | null>;
  const networks = computed(() => {
    const grouped = useGroupBy(nodes.value, 'network');
    return Object.keys(grouped);
  });

  async function fetchNodes() {
    const { data, error: err } = await useFetch('/api/nodes');
    if (err.value) {
      error.value = err.value || 'Unknown error';
      return;
    }
    const { nodes: fetchedNodes } = data.value as { nodes: Node[] };
    nodes.value = fetchedNodes;
  }

  return {
    fetchNodes,
    error,
    nodes,
    networks
  };
}

export default createSharedComposable(useFetchNodes);
