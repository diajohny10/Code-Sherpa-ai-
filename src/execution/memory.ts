export const MAX_MEMORY_PAGES = 4096;

export function limitMemory(bytes: Uint8Array): Uint8Array {
  let position = 8;
  const read = (): number => {
    let result = 0;
    for (let shift = 0; shift <= 28; shift += 7) {
      if (position >= bytes.length) throw new Error('Truncated WASM');
      const byte = bytes[position++];
      result += (byte & 127) * 2 ** shift;
      if (!(byte & 128)) {
        if (result > 0xffffffff) throw new Error('Invalid WASM integer');
        return result;
      }
    }
    throw new Error('Invalid WASM integer');
  };
  const encode = (value: number): number[] => {
    const result = [];
    do { const byte = value & 127; value = Math.floor(value / 128); result.push(byte | (value ? 128 : 0)); } while (value);
    return result;
  };
  if (bytes.length < 8 || bytes.slice(0, 8).some((byte, index) => byte !== [0, 97, 115, 109, 1, 0, 0, 0][index])) throw new Error('Invalid WASM header');
  let replacement: { start: number; end: number; bytes: Uint8Array } | undefined;
  while (position < bytes.length) {
    const start = position;
    const section = bytes[position++];
    const size = read();
    const end = position + size;
    if (end > bytes.length) throw new Error('Truncated WASM section');
    if (section === 5) {
      if (replacement || read() !== 1) throw new Error('Exactly one defined memory is required');
      const flags = read();
      if (flags !== 0 && flags !== 1) throw new Error('Only 32-bit unshared memory is supported');
      const initial = read();
      const maximum = flags === 1 ? read() : MAX_MEMORY_PAGES;
      if (position !== end || initial > MAX_MEMORY_PAGES || maximum < initial) throw new Error('Unsupported WASM memory limits');
      const payload = [1, 1, ...encode(initial), ...encode(Math.min(maximum, MAX_MEMORY_PAGES))];
      replacement = { start, end, bytes: new Uint8Array([5, ...encode(payload.length), ...payload]) };
    }
    position = end;
  }
  if (!replacement) throw new Error('Defined memory section missing');
  const result = new Uint8Array(replacement.start + replacement.bytes.length + bytes.length - replacement.end);
  result.set(bytes.subarray(0, replacement.start));
  result.set(replacement.bytes, replacement.start);
  result.set(bytes.subarray(replacement.end), replacement.start + replacement.bytes.length);
  return result;
}