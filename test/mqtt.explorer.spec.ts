import { MetadataScanner } from '@nestjs/core';
import {
  MqttModuleOptions,
  MqttSubscribeOptions,
  MqttSubscriberParameter,
} from '../src/mqtt.interface';
import { MqttExplorer } from '../src/mqtt.explorer';
import { createMockClient } from './helpers/mock-client';
import { createMockLogger } from './helpers/mock-logger';

function createExplorer(options: MqttModuleOptions = {}) {
  const logger = createMockLogger();
  const client = createMockClient();
  // discovery is stubbed out: routing tests drive the explorer through
  // subscribe() + explore() without a Nest container
  const discovery = { getProviders: () => [], getControllers: () => [] };
  const explorer = new MqttExplorer(
    discovery as any,
    new MetadataScanner(),
    logger as any,
    client,
    options,
  );
  return { explorer, logger, client };
}

interface SubscribeArgs {
  explorer: MqttExplorer;
  options: MqttSubscribeOptions;
  handle: jest.Mock;
  parameters?: MqttSubscriberParameter[];
}

function subscribe({ explorer, options, handle, parameters = [] }: SubscribeArgs) {
  explorer.subscribe(options, parameters, handle, { marker: 'provider' });
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('preprocess', () => {
  it('keeps plain topics untouched', () => {
    const { explorer } = createExplorer();
    expect(explorer.preprocess({ topic: 'foo/bar' })).toBe('foo/bar');
  });

  it('strips $queue/ and $share/<group>/ prefixes from the decorator topic', () => {
    const { explorer } = createExplorer();
    expect(explorer.preprocess({ topic: '$queue/foo/bar' })).toBe('foo/bar');
    expect(explorer.preprocess({ topic: '$share/g1/foo/bar' })).toBe('foo/bar');
  });

  it('prepends $queue/ when the global queue option is set', () => {
    const { explorer } = createExplorer({ queue: true });
    expect(explorer.preprocess({ topic: 'foo/bar' })).toBe('$queue/foo/bar');
  });

  it('lets the per-topic queue option override the global one', () => {
    const { explorer } = createExplorer({ queue: true });
    expect(explorer.preprocess({ topic: 'foo/bar', queue: false })).toBe('foo/bar');
  });

  it('prepends $share/<group>/ when the global share option is set', () => {
    const { explorer } = createExplorer({ share: 'workers' });
    expect(explorer.preprocess({ topic: 'foo/bar' })).toBe('$share/workers/foo/bar');
  });

  it('processes every topic of an array', () => {
    const { explorer } = createExplorer({ share: 'g' });
    expect(explorer.preprocess({ topic: ['a', 'b/c'] })).toEqual(['$share/g/a', '$share/g/b/c']);
  });
});

describe('topicToRegexp', () => {
  const toRegexp = (topic: string): RegExp => (MqttExplorer as any).topicToRegexp(topic);
  // the regexes use the sticky flag and carry lastIndex across calls;
  // production always resets it before testing (getSubscriber), mirror that here
  const testTopic = (re: RegExp, topic: string): boolean => {
    re.lastIndex = 0;
    return re.test(topic);
  };

  it('matches exact topics only', () => {
    expect(testTopic(toRegexp('foo/bar'), 'foo/bar')).toBe(true);
    expect(testTopic(toRegexp('foo/bar'), 'foo/baz')).toBe(false);
    expect(testTopic(toRegexp('foo/bar'), 'foo/bar/qux')).toBe(false);
  });

  it('expands + to exactly one level', () => {
    const re = toRegexp('foo/+/baz');
    expect(testTopic(re, 'foo/bar/baz')).toBe(true);
    expect(testTopic(re, 'foo/bar/qux/baz')).toBe(false);
  });

  it('expands a trailing # to the remaining levels (including the parent topic)', () => {
    const re = toRegexp('foo/#');
    expect(testTopic(re, 'foo')).toBe(true);
    expect(testTopic(re, 'foo/bar')).toBe(true);
    expect(testTopic(re, 'foo/bar/qux')).toBe(true);
    expect(testTopic(toRegexp('foo/#'), 'foobar')).toBe(false);
  });

  it('strips $queue/ and $share/<group>/ prefixes before matching', () => {
    expect(testTopic(toRegexp('$queue/foo/+/baz'), 'foo/bar/baz')).toBe(true);
    expect(testTopic(toRegexp('$share/g1/foo/+/baz'), 'foo/bar/baz')).toBe(true);
  });

  it('escapes regex metacharacters in the topic', () => {
    expect(testTopic(toRegexp('foo.bar'), 'fooXbar')).toBe(false);
    expect(testTopic(toRegexp('foo.bar'), 'foo.bar')).toBe(true);
  });
});

describe('matchGroups', () => {
  const toRegexp = (topic: string): RegExp => (MqttExplorer as any).topicToRegexp(topic);
  const matchGroups = (topic: string, re: RegExp): string[] =>
    (MqttExplorer as any).matchGroups(topic, re);

  it('extracts wildcard segments in order', () => {
    expect(matchGroups('foo/kitchen/device/sensor1', toRegexp('foo/+/device/+'))).toEqual([
      'kitchen',
      'sensor1',
    ]);
  });

  it('returns an empty array for non-matching topics', () => {
    expect(matchGroups('other/thing', toRegexp('foo/+'))).toEqual([]);
  });
});

describe('subscribe', () => {
  it('subscribes with the preprocessed topic and stores the subscriber on success', () => {
    const { explorer, client } = createExplorer({ share: 'g' });
    const provider = { id: 'prov' };
    explorer.subscribe({ topic: 'a/+/b' }, [], jest.fn(), provider);
    expect(client.subscribe).toHaveBeenCalledWith('$share/g/a/+/b', undefined, expect.any(Function));
    expect(explorer.subscribers).toHaveLength(1);
    expect(explorer.subscribers[0]).toMatchObject({ topic: 'a/+/b', provider });
  });

  it('does not store the subscriber and logs on subscribe failure', () => {
    const { explorer, client, logger } = createExplorer();
    client.subscribe.mockImplementation((t, o, cb) => {
      cb(new Error('refused'));
      return client;
    });
    explorer.subscribe({ topic: 'x/#' }, [], jest.fn(), {});
    expect(explorer.subscribers).toHaveLength(0);
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('message routing', () => {
  // wire the client 'message' listener (done inside explore()) before emitting
  function subscribeAndExplore(args: SubscribeArgs) {
    subscribe(args);
    args.explorer.explore();
  }

  it('routes to the matching subscriber with the topic-level (default json) transform', () => {
    const { explorer, client } = createExplorer();
    const handle = jest.fn();
    subscribeAndExplore({
      explorer,
      options: { topic: 'app/+/state' },
      handle,
      parameters: [{ index: 0, type: 'payload' }],
    });
    client.emit('message', 'app/dev1/state', Buffer.from('{"a":1}'), {});
    expect(handle).toHaveBeenCalledWith({ a: 1 });
  });

  it('applies a @Payload(transform) parameter over the topic-level transform', () => {
    const { explorer, client } = createExplorer();
    const handle = jest.fn();
    subscribeAndExplore({
      explorer,
      options: { topic: 'app/text/#', transform: 'json' },
      handle,
      parameters: [
        { index: 0, type: 'payload', transform: 'text' },
        { index: 1, type: 'topic' },
      ],
    });
    client.emit('message', 'app/text/dev1', Buffer.from('{"a":1}'), {});
    expect(handle).toHaveBeenCalledWith('{"a":1}', 'app/text/dev1');
  });

  it('passes the raw packet and wildcard params by parameter type', () => {
    const { explorer, client } = createExplorer();
    const handle = jest.fn();
    const packet = { cmd: 'publish' };
    subscribeAndExplore({
      explorer,
      options: { topic: 'p/+/q' },
      handle,
      parameters: [
        { index: 0, type: 'params' },
        { index: 1, type: 'packet' },
      ],
    });
    client.emit('message', 'p/x/q', Buffer.from(''), packet);
    expect(handle).toHaveBeenCalledWith(['x'], packet);
  });

  it('logs async handler rejections instead of letting them escape', async () => {
    const { explorer, client, logger } = createExplorer();
    const handle = jest.fn(async () => {
      throw new Error('boom');
    });
    subscribeAndExplore({ explorer, options: { topic: 'async/#' }, handle });
    client.emit('message', 'async/1', Buffer.from(''), {});
    await flush();
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
  });

  it('logs async beforeHandle rejections and skips the handler', async () => {
    const before = jest.fn(async () => {
      throw new Error('before boom');
    });
    const { explorer, client, logger } = createExplorer({ beforeHandle: before });
    const handle = jest.fn();
    subscribeAndExplore({ explorer, options: { topic: 'bh-async/#' }, handle });
    client.emit('message', 'bh-async/1', Buffer.from(''), {});
    await flush();
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ message: 'before boom' }));
    expect(handle).not.toHaveBeenCalled();
  });

  it('still logs synchronous handler failures', () => {
    const { explorer, client, logger } = createExplorer();
    const handle = jest.fn(() => {
      throw new Error('sync boom');
    });
    subscribeAndExplore({ explorer, options: { topic: 'sync/#' }, handle });
    client.emit('message', 'sync/1', Buffer.from(''), {});
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ message: 'sync boom' }));
  });

  it('ignores messages that match no subscriber', () => {
    const { explorer, client } = createExplorer();
    const handle = jest.fn();
    subscribeAndExplore({ explorer, options: { topic: 'known/#' }, handle });
    client.emit('message', 'unknown/1', Buffer.from(''), {});
    expect(handle).not.toHaveBeenCalled();
  });

  it('calls beforeHandle before the handler', async () => {
    const before = jest.fn();
    const { explorer, client } = createExplorer({ beforeHandle: before });
    const handle = jest.fn();
    subscribeAndExplore({ explorer, options: { topic: 'bh/#' }, handle });
    client.emit('message', 'bh/1', Buffer.from(''), { cmd: 'publish' });
    await flush();
    expect(before).toHaveBeenCalledWith('bh/1', Buffer.from(''), { cmd: 'publish' });
    expect(before.mock.invocationCallOrder[0]).toBeLessThan(handle.mock.invocationCallOrder[0]);
  });
});
