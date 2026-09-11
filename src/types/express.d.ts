import { Node } from '../helpers/nodes';
import { Pending } from '../middlewares/withRpcCache';

declare global {
  namespace Express {
    interface Request {
      // Set by setNode, which only runs on the /:network RPC route -
      // not on /delegation or /subgraph.
      _node: Node;
      _cache?: Pending;
    }
  }
}
