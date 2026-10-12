// Cache missing RPC function/signature variants for the lifetime of this app tab.
// Some deployments apply SQL patches gradually; without this cache every refresh
// would repeat the same failed PostgREST schema-cache lookups before falling back.
const missingRpcErrors = new Map();

export function isMissingRpcFunctionError(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '');
  return code === '42883'
    || code === 'PGRST202'
    || code === 'PGRST203'
    || /function .* does not exist/i.test(message)
    || /could not find the function .* in the schema cache/i.test(message)
    || /schema cache.*function/i.test(message);
}

/**
 * Calls compatible RPC variants from newest to oldest. Only missing-function /
 * schema-cache errors trigger fallback; authorization, validation, and network
 * errors are returned immediately and are never silently treated as version gaps.
 * A missing variant is probed at most once per browser tab.
 */
export async function rpcWithFallback(client, variants) {
  let lastMissingResult = null;

  for (const variant of variants) {
    if (!variant?.name) continue;

    if (missingRpcErrors.has(variant.name)) {
      lastMissingResult = {
        data: null,
        error: missingRpcErrors.get(variant.name),
        functionName: variant.name,
      };
      continue;
    }

    const result = await client.rpc(variant.name, variant.params ?? {});
    if (!result.error) return { ...result, functionName: variant.name };
    if (!isMissingRpcFunctionError(result.error)) {
      return { ...result, functionName: variant.name };
    }

    missingRpcErrors.set(variant.name, result.error);
    lastMissingResult = { ...result, functionName: variant.name };
  }

  return lastMissingResult || {
    data: null,
    error: new Error('কোনো সমর্থিত Supabase RPC সংস্করণ পাওয়া যায়নি।'),
    functionName: null,
  };
}
