export function sanitizeId(body: any): string | number | null {
  return body && (typeof body.id === 'string' || typeof body.id === 'number' || body.id === null)
    ? body.id
    : null;
}
