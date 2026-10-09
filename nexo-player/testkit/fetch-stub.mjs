/**
 * Sustituye globalThis.fetch por un handler determinista.
 */

/**
 * @param {(url:string, init:object) => any} handler
 *   Devuelve un Response, o `{ status, body, headers }`.
 * @returns {{calls: Array<{url:string, init:object}>, restore: () => void}}
 */
export function stubFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    const result = await handler(url, init ?? {});
    if (result instanceof Response) return result;
    return new Response(result.body ?? '', {
      status: result.status ?? 200,
      headers: result.headers,
    });
  };

  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}
