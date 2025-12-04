import { performance } from 'perf_hooks';

export class SocketLogger {
  constructor(prefix = 'Socket') {
    this.prefix = prefix;
  }

  info(message, data = {}) {
    console.log(`[${this.prefix}] ℹ️ ${message}`, data);
  }

  error(message, error) {
    console.error(`[${this.prefix}] ❌ ${message}`, error);
  }

  warn(message, data = {}) {
    console.warn(`[${this.prefix}] ⚠️ ${message}`, data);
  }

  debug(message, data = {}) {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(`[${this.prefix}] 🔍 ${message}`, data);
    }
  }

  trackPerformance(operationName, fn) {
    const start = performance.now();
    const result = fn();
    const end = performance.now();
    
    this.debug(`Performance - ${operationName}`, {
      duration: `${(end - start).toFixed(2)}ms`
    });
    
    return result;
  }

  async trackAsyncPerformance(operationName, fn) {
    const start = performance.now();
    const result = await fn();
    const end = performance.now();
    
    this.debug(`Performance - ${operationName}`, {
      duration: `${(end - start).toFixed(2)}ms`
    });
    
    return result;
  }
}