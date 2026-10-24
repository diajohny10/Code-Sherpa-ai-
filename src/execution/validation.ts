import type { JSONValue, PythonExecutionRequest } from './types.ts';

const encoder = new TextEncoder();
export const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);
export function validateJSON(value: unknown, depth = 0, budget = { remaining: 10000 }): asserts value is JSONValue {
  if (--budget.remaining < 0 || depth > 32) throw new Error('JSON nesting or size limit exceeded');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return;
  if (typeof value !== 'object' || !value || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new Error('Only finite, safe JSON values are supported');
  for (const entry of Object.values(value)) validateJSON(entry, depth + 1, budget);
}
export function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable((value as Record<string, unknown>)[key])).join(',') + '}';
  return JSON.stringify(value);
}
export async function sha256(value: Uint8Array | string): Promise<string> {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function validateRequest(value: PythonExecutionRequest): void {
  if (!value || typeof value.source !== 'string' || value.source.length > 20000 || !['syntax', 'run', 'test'].includes(value.operation) || !['script', 'function'].includes(value.mode)) throw new Error('Invalid Python execution request (source maximum 20000 characters)');
  if (value.mode === 'function' && value.operation !== 'syntax' &&
      (typeof value.functionName !== 'string' || value.functionName.length < 1 || value.functionName.length > 128 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.functionName))) throw new Error('A simple Python function identifier of 1-128 characters is required');
  if (!Array.isArray(value.cases) || value.cases.length < 1 || value.cases.length > 10 || (value.operation !== 'test' && value.cases.length !== 1)) throw new Error('Use 1-10 cases; run and syntax require exactly one');
  const ids = new Set<string>();
  for (const entry of value.cases) {
    if (!entry || typeof entry.id !== 'string' || !entry.id.length || entry.id.length > 128 || ids.has(entry.id)) throw new Error('Case IDs must be unique bounded strings');
    ids.add(entry.id);
    if (entry.stdin !== undefined && (typeof entry.stdin !== 'string' || encoder.encode(entry.stdin).length > 8192)) throw new Error('stdin maximum is 8192 UTF-8 bytes');
    if (entry.args !== undefined && !Array.isArray(entry.args)) throw new Error('args must be a JSON array');
    if (value.operation === 'test' && !hasOwn(entry, 'expected')) throw new Error('Test cases require expected (null is allowed in function mode)');
    for (const key of ['args', 'expected'] as const) if (hasOwn(entry, key)) {
      validateJSON(entry[key]);
      if (encoder.encode(JSON.stringify(entry[key])).length > 8192) throw new Error(`${key} maximum is 8192 encoded bytes`);
    }
    if (value.mode === 'script' && hasOwn(entry, 'expected') && typeof entry.expected !== 'string') throw new Error('Script expected output must be a string');
  }
}
export const normalizeOutput = (value: string): string => value.replace(/\r\n/g, '\n').replace(/\n+$/, '');