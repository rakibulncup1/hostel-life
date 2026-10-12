import test from 'node:test';
import assert from 'node:assert/strict';
import { isMissingRpcFunctionError, rpcWithFallback } from '../src/lib/rpcCompatibility.js';

test('recognizes PostgREST missing-function/schema-cache errors', () => {
  assert.equal(isMissingRpcFunctionError({ code: 'PGRST202' }), true);
  assert.equal(isMissingRpcFunctionError({ code: '42883' }), true);
  assert.equal(isMissingRpcFunctionError({ code: '42501', message: 'permission denied' }), false);
});

test('probes a missing RPC once, then uses the compatible fallback', async () => {
  const calls = [];
  const client = {
    async rpc(name, params) {
      calls.push({ name, params });
      if (name === 'test_missing_latest_rpc') {
        return { data: null, error: { code: 'PGRST202', message: 'Function missing from schema cache' } };
      }
      return { data: [{ ok: true }], error: null };
    },
  };
  const variants = [
    { name: 'test_missing_latest_rpc', params: { p_limit: 10 } },
    { name: 'test_available_legacy_rpc', params: { p_limit: 10 } },
  ];

  const first = await rpcWithFallback(client, variants);
  assert.equal(first.functionName, 'test_available_legacy_rpc');
  assert.deepEqual(first.data, [{ ok: true }]);
  assert.equal(calls.length, 2);

  const second = await rpcWithFallback(client, variants);
  assert.equal(second.functionName, 'test_available_legacy_rpc');
  assert.equal(calls.length, 3, 'the known-missing RPC must not be requested again');
});

test('does not fan out after permission or validation errors', async () => {
  const calls = [];
  const client = {
    async rpc(name) {
      calls.push(name);
      return { data: null, error: { code: '42501', message: 'permission denied' } };
    },
  };
  const result = await rpcWithFallback(client, [
    { name: 'test_forbidden_rpc' },
    { name: 'test_must_not_be_called' },
  ]);
  assert.equal(result.error.code, '42501');
  assert.deepEqual(calls, ['test_forbidden_rpc']);
});
