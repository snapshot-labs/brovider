import snapshot from '@snapshot-labs/snapshot.js';
import networks from '@snapshot-labs/snapshot.js/src/networks.json';
import axios from 'axios';

export let updatedNetworks: any = networks;

// Get the list of networks from github and then wait for 10 minutes and then request the again.
const loadNetworks = () => {
  axios
    .get('https://raw.githubusercontent.com/snapshot-labs/snapshot.js/master/src/networks.json', {
      timeout: 6e4
    })
    .then(function (response) {
      console.log('[loadNetworks] Networks updated from github');
      updatedNetworks = response.data;
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
