import { checkRuntime } from './prepare-python-runtime.mjs';

try {
  const manifest = await checkRuntime();
  console.log(`CPython ${manifest.runtimeVersion} WASI assets verified.`);
} catch (error) {
  console.error(`Python runtime unavailable or invalid: ${error.message}. Run npm run prepare:python.`);
  process.exitCode = 1;
}