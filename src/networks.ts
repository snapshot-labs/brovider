import snapshot from '@snapshot-labs/snapshot.js';
import networks from '@snapshot-labs/snapshot.js/src/networks.json';
import { customFetch } from './utils';

export let updatedNetworks: any = networks;

// Get the list of networks from github and then wait for 10 minutes and then request the again.
const loadNetworks = () => {
  customFetch(
    'https://raw.githubusercontent.com/snapshot-labs/snapshot.js/master/src/networks.json'
  )
    .then(res => res.json())
    .then(function (response: any = {}) {
      // make sure response is not empty
      if (response['1']?.key === '1') updatedNetworks = response;
      console.log('[loadNetworks] Networks updated from github');
    })
    .catch(function (error) {
      console.log(`[loadNetworks] ${error}`);
    })
    .then(function () {
      // always executed irrespective of the promise status
      snapshot.utils.sleep(6e5).then(() => loadNetworks());
    });
};

loadNetworks();
