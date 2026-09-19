import { getTransform, JsonTransform, TextTransform } from '../src/mqtt.transform';

describe('mqtt.transform', () => {
  const payload = Buffer.from(JSON.stringify({ hello: 'world' }));

  it('JsonTransform parses the payload as JSON', () => {
    expect(JsonTransform(payload)).toEqual({ hello: 'world' });
  });

  it('TextTransform decodes the payload as utf-8', () => {
    expect(TextTransform(payload)).toBe('{"hello":"world"}');
  });

  it('getTransform passes custom transformer functions through', () => {
    const custom = jest.fn((p: Buffer) => p.length);
    expect(getTransform(custom)).toBe(custom);
  });

  it('getTransform maps "text" to TextTransform', () => {
    expect(getTransform('text')).toBe(TextTransform);
  });

  it('getTransform maps "json" and unknown values to the JSON transform', () => {
    expect(getTransform('json')).toBe(JsonTransform);
    expect(getTransform(undefined)).toBe(JsonTransform);
  });
});
