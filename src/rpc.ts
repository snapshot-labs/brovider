import express from 'express';
import networks from '@snapshot-labs/snapshot.js/src/networks.json';

const router = express.Router();

router.all('/s/:network', async (req, res) => {
  const { network } = req.params;
  const url = networks[network].rpc[0];
  console.log(url, req.body);
  // @TODO pipe / stream relayed request
  res.json({ url });
});

export default router;
