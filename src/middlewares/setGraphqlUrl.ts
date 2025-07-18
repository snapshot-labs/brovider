import { NextFunction, Request, Response } from 'express';
import { subgraphs } from '../constants';
import { SubgraphError } from '../errors/SubgraphError';

export default function setGraphqlUrl(req: Request, _res: Response, next: NextFunction) {
  const network = req.params.network;
  const subgraph = req.params.subgraph;

  const isDelegation = !subgraph;
  const type = isDelegation ? 'delegation' : 'subgraph';

  const url = subgraphs[type][network];
  if (!url) {
    return next(new SubgraphError('Invalid network', 400));
  }

  (req as any)._subgraph_url = { url: isDelegation ? url : url + subgraph };

  next();
}
