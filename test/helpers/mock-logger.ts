// Mock covering the full LoggerService surface (log/error/warn plus the
// optional verbose/debug/fatal), so assertions keep working if production
// code starts calling the less common levels.
export function createMockLogger() {
  return {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    verbose: jest.fn(),
    debug: jest.fn(),
    fatal: jest.fn(),
  };
}
