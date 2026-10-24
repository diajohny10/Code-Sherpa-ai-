export type JSONValue = null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue };
export interface PythonTestCase { id: string; stdin?: string; args?: JSONValue[]; expected?: JSONValue }
export interface PythonExecutionRequest {
  source: string; operation: 'syntax' | 'run' | 'test'; mode: 'script' | 'function'; functionName?: string; cases: PythonTestCase[];
}
export type PythonCaseStatus = 'passed' | 'failed' | 'completed' | 'syntax_error' | 'runtime_error' | 'timeout' | 'output_limit' | 'memory_limit' | 'cancelled' | 'unsupported' | 'engine_error';
export interface PythonCaseResult {
  id: string; status: PythonCaseStatus; stdout: string; stderr: string; exitCode: number | null; actual?: JSONValue;
  error?: { type: string; message: string; line?: number }; durationMs: number;
}
export interface PythonExecutionReport {
  engine: 'cpython-wasi'; runtimeVersion: string; operation: PythonExecutionRequest['operation']; mode: PythonExecutionRequest['mode'];
  sourceHash: string; suiteHash: string; results: PythonCaseResult[]; passed: number; failed: number; allPassed: boolean; durationMs: number;
}