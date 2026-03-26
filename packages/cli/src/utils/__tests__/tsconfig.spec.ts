import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findTsconfigFiles, removeEsModuleInteropFalseFromFile } from '../tsconfig.js';

describe('findTsconfigFiles', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsconfig-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds all tsconfig variants', () => {
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.app.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.node.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.build.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'other.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');

    const files = findTsconfigFiles(tmpDir);
    const expected = [
      path.join(tmpDir, 'tsconfig.app.json'),
      path.join(tmpDir, 'tsconfig.build.json'),
      path.join(tmpDir, 'tsconfig.json'),
      path.join(tmpDir, 'tsconfig.node.json'),
    ];
    expect(new Set(files)).toEqual(new Set(expected));
    expect(files).toHaveLength(4);
  });

  it('returns empty array for non-existent directory', () => {
    expect(findTsconfigFiles('/non-existent-dir-12345')).toEqual([]);
  });

  it('returns empty array when no tsconfig files exist', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    expect(findTsconfigFiles(tmpDir)).toEqual([]);
  });
});

describe('removeEsModuleInteropFalseFromFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsconfig-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('removes esModuleInterop: false', () => {
    const filePath = path.join(tmpDir, 'tsconfig.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2023',
            esModuleInterop: false,
            strict: true,
          },
        },
        null,
        2,
      ),
    );

    const result = removeEsModuleInteropFalseFromFile(filePath);
    expect(result).toBe(true);

    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(content.compilerOptions).not.toHaveProperty('esModuleInterop');
    expect(content.compilerOptions.target).toBe('ES2023');
    expect(content.compilerOptions.strict).toBe(true);
  });

  it('preserves comments in JSONC', () => {
    const filePath = path.join(tmpDir, 'tsconfig.json');
    const content = `{
  // This is a comment
  "compilerOptions": {
    "target": "ES2023",
    "esModuleInterop": false,
    /* block comment */
    "strict": true
  }
}
`;
    fs.writeFileSync(filePath, content);

    const result = removeEsModuleInteropFalseFromFile(filePath);
    expect(result).toBe(true);

    const newContent = fs.readFileSync(filePath, 'utf-8');
    expect(newContent).toContain('// This is a comment');
    expect(newContent).toContain('/* block comment */');
    expect(newContent).not.toContain('esModuleInterop');
    expect(newContent).toContain('"strict": true');
  });

  it('handles esModuleInterop: false as last property (trailing comma on previous line is valid JSONC)', () => {
    const filePath = path.join(tmpDir, 'tsconfig.json');
    const content = `{
  "compilerOptions": {
    "target": "ES2023",
    "esModuleInterop": false
  }
}
`;
    fs.writeFileSync(filePath, content);

    const result = removeEsModuleInteropFalseFromFile(filePath);
    expect(result).toBe(true);

    const newContent = fs.readFileSync(filePath, 'utf-8');
    expect(newContent).not.toContain('esModuleInterop');
    expect(newContent).toContain('"target": "ES2023"');
  });

  it('leaves esModuleInterop: true untouched', () => {
    const filePath = path.join(tmpDir, 'tsconfig.json');
    const original = JSON.stringify({ compilerOptions: { esModuleInterop: true } }, null, 2);
    fs.writeFileSync(filePath, original);

    const result = removeEsModuleInteropFalseFromFile(filePath);
    expect(result).toBe(false);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(original);
  });

  it('returns false for non-existent file', () => {
    expect(removeEsModuleInteropFalseFromFile('/non-existent-file.json')).toBe(false);
  });

  it('returns false when no compilerOptions', () => {
    const filePath = path.join(tmpDir, 'tsconfig.json');
    fs.writeFileSync(filePath, '{}');

    expect(removeEsModuleInteropFalseFromFile(filePath)).toBe(false);
  });

  it('returns false when esModuleInterop is not present', () => {
    const filePath = path.join(tmpDir, 'tsconfig.json');
    fs.writeFileSync(filePath, JSON.stringify({ compilerOptions: { strict: true } }, null, 2));

    expect(removeEsModuleInteropFalseFromFile(filePath)).toBe(false);
  });
});
