import type { ProjectFile } from './project-template.js';

const encoder = new TextEncoder();
const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  crcTable[index] = value >>> 0;
}

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 0xff]!;
  return (value ^ 0xffffffff) >>> 0;
}

function header(size: number): { readonly bytes: Uint8Array; readonly view: DataView } {
  const bytes = new Uint8Array(size);
  return { bytes, view: new DataView(bytes.buffer) };
}

function append(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

export function zipProject(files: readonly ProjectFile[]): Blob {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    if (file.path.startsWith('/') || file.path.split('/').includes('..'))
      throw new TypeError('Project file paths must remain relative.');
    const name = encoder.encode(file.path);
    const content = encoder.encode(file.content);
    const checksum = crc32(content);
    const localHeader = header(30);
    localHeader.view.setUint32(0, 0x04034b50, true);
    localHeader.view.setUint16(4, 20, true);
    localHeader.view.setUint16(6, 0x0800, true);
    localHeader.view.setUint32(14, checksum, true);
    localHeader.view.setUint32(18, content.byteLength, true);
    localHeader.view.setUint32(22, content.byteLength, true);
    localHeader.view.setUint16(26, name.byteLength, true);
    local.push(localHeader.bytes, name, content);

    const centralHeader = header(46);
    centralHeader.view.setUint32(0, 0x02014b50, true);
    centralHeader.view.setUint16(4, 20, true);
    centralHeader.view.setUint16(6, 20, true);
    centralHeader.view.setUint16(8, 0x0800, true);
    centralHeader.view.setUint32(16, checksum, true);
    centralHeader.view.setUint32(20, content.byteLength, true);
    centralHeader.view.setUint32(24, content.byteLength, true);
    centralHeader.view.setUint16(28, name.byteLength, true);
    centralHeader.view.setUint32(42, offset, true);
    central.push(centralHeader.bytes, name);
    offset += localHeader.bytes.byteLength + name.byteLength + content.byteLength;
  }
  const centralBytes = append(central);
  const end = header(22);
  end.view.setUint32(0, 0x06054b50, true);
  end.view.setUint16(8, files.length, true);
  end.view.setUint16(10, files.length, true);
  end.view.setUint32(12, centralBytes.byteLength, true);
  end.view.setUint32(16, offset, true);
  const archive = append([...local, centralBytes, end.bytes]);
  const bytes = new ArrayBuffer(archive.byteLength);
  new Uint8Array(bytes).set(archive);
  return new Blob([bytes], { type: 'application/zip' });
}
