import { Node } from '../helpers/chainHead';
import { Pending } from '../middlewares/withRpcCache';

declare global {
  namespace Express {
    interface Request {
      _node: Node;
      _cache?: Pending;
    }
  }
}
