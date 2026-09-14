import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isBridgeMessage, MESSAGE_TYPES, PROTOCOL_VERSION } from '../../src/bridge/protocol';

// The schema lives outside extension/ on purpose (shared contract); read it as a file only in tests.
const SCHEMA_PATH = resolve(__dirname, '../../../protocol/bridge.schema.json');
const VERSION_PATH = resolve(__dirname, '../../../protocol/VERSION');

describe('bridge protocol ↔ protocol/bridge.schema.json', () => {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as {
    oneOf: { $ref: string }[];
    definitions: Record<string, { properties?: { type?: { const?: string } } }>;
  };

  it('message list matches the schema oneOf, in order', () => {
    const fromSchema = schema.oneOf.map((r) => r.$ref.replace('#/definitions/', ''));
    expect([...MESSAGE_TYPES]).toEqual(fromSchema);
  });

  it('every schema message definition has a const type equal to its name', () => {
    for (const t of MESSAGE_TYPES) {
      expect(schema.definitions[t]?.properties?.type?.const).toBe(t);
    }
  });

  it('PROTOCOL_VERSION matches protocol/VERSION', () => {
    expect(readFileSync(VERSION_PATH, 'utf8').trim()).toBe(PROTOCOL_VERSION);
  });

  it('isBridgeMessage guards on known types', () => {
    expect(isBridgeMessage({ type: 'ping' })).toBe(true);
    expect(isBridgeMessage({ type: 'nope' })).toBe(false);
    expect(isBridgeMessage(null)).toBe(false);
    expect(isBridgeMessage('ping')).toBe(false);
  });
});
