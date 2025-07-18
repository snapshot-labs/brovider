export class SubgraphError extends Error {
  public statusCode: number;
  public errors?: any[];

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = 'SubgraphError';
    this.statusCode = statusCode;
  }

  static fromGraphQLResult(result: any, statusCode = 400): SubgraphError {
    const error = new SubgraphError('GraphQL query error', statusCode);
    error.errors = result.errors;
    return error;
  }
}
