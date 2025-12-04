import { createClient } from 'redis';
import { config } from 'dotenv';

config();

class RedisClient {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.connect();
  }

  async connect() {
    try {
        const useTLS = process.env.REDIS_TLS === 'true';
        const redisOptions = {
          url: process.env.REDIS_URL || 'redis://localhost:6379',
          socket: {
            connectTimeout: 60000,
            lazyConnect: true,
            reconnectStrategy: (retries) => {
              if (retries > 10) {
                console.log('❌ Too many attempts to reconnect. Redis connection terminated.');
                return new Error('Too many retries.');
              }
              return Math.min(retries * 100, 3000);
            },
            tls: useTLS
          }
        };

        // Agregar password si está configurado
        if (process.env.REDIS_PASSWORD) {
          redisOptions.password = process.env.REDIS_PASSWORD;
        }

        this.client = createClient(redisOptions);

      // Manejar eventos de conexión
      this.client.on('connect', () => {
        console.log('🟡 Redis: Connecting...');
      });

      this.client.on('ready', () => {
        this.isConnected = true;
        console.log('✅ Redis: Connected and ready');
      });

      this.client.on('error', (err) => {
        this.isConnected = false;
        console.error('🔴 Redis Client Error:', err.message);
      });

      this.client.on('end', () => {
        this.isConnected = false;
        console.log('🔴 Redis: Connection closed');
      });

      this.client.on('reconnecting', () => {
        console.log('🟡 Redis: Reconnecting...');
      });

      // Conectar al cliente
      await this.client.connect();

    } catch (error) {
      console.error('❌ Failed to connect to Redis:', error.message);
      this.isConnected = false;
    }
  }

  async set(key, value, options = {}) {
    if (!this.isConnected) {
      console.warn('⚠️ Redis not connected, skipping set operation');
      return null;
    }

    try {
      const serializedValue = typeof value === 'object' ? JSON.stringify(value) : value;
      let result;

      if (options.EX) {
        result = await this.client.set(key, serializedValue, { EX: options.EX });
      } else if (options.PX) {
        result = await this.client.set(key, serializedValue, { PX: options.PX });
      } else {
        result = await this.client.set(key, serializedValue);
      }

      return result;
    } catch (error) {
      console.error('❌ Redis set error:', error.message);
      return null;
    }
  }

  async get(key) {
    if (!this.isConnected) {
      console.warn('⚠️ Redis not connected, skipping get operation');
      return null;
    }

    try {
      const value = await this.client.get(key);
      
      if (!value) return null;

      // Intentar parsear como JSON, si falla retornar el string
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    } catch (error) {
      console.error('❌ Redis get error:', error.message);
      return null;
    }
  }

  async del(key) {
    if (!this.isConnected) {
      console.warn('⚠️ Redis not connected, skipping delete operation');
      return 0;
    }

    try {
      return await this.client.del(key);
    } catch (error) {
      console.error('❌ Redis delete error:', error.message);
      return 0;
    }
  }

  async exists(key) {
    if (!this.isConnected) {
      console.warn('⚠️ Redis not connected, skipping exists check');
      return 0;
    }

    try {
      return await this.client.exists(key);
    } catch (error) {
      console.error('❌ Redis exists error:', error.message);
      return 0;
    }
  }

  async expire(key, seconds) {
    if (!this.isConnected) {
      console.warn('⚠️ Redis not connected, skipping expire operation');
      return false;
    }

    try {
      return await this.client.expire(key, seconds);
    } catch (error) {
      console.error('❌ Redis expire error:', error.message);
      return false;
    }
  }

  async ttl(key) {
    if (!this.isConnected) {
      console.warn('⚠️ Redis not connected, skipping TTL check');
      return -2;
    }

    try {
      return await this.client.ttl(key);
    } catch (error) {
      console.error('❌ Redis TTL error:', error.message);
      return -2;
    }
  }

  async keys(pattern) {
    if (!this.isConnected) {
      console.warn('⚠️ Redis not connected, skipping keys operation');
      return [];
    }

    try {
      return await this.client.keys(pattern);
    } catch (error) {
      console.error('❌ Redis keys error:', error.message);
      return [];
    }
  }

  async flushAll() {
    if (!this.isConnected) {
      console.warn('⚠️ Redis not connected, skipping flush operation');
      return;
    }

    try {
      await this.client.flushAll();
      console.log('✅ Redis: All keys flushed');
    } catch (error) {
      console.error('❌ Redis flushAll error:', error.message);
    }
  }

  async hSet(key, field, value) {
    if (!this.isConnected) {
      console.warn('⚠️ Redis not connected, skipping hSet operation');
      return 0;
    }

    try {
      const serializedValue = typeof value === 'object' ? JSON.stringify(value) : value;
      return await this.client.hSet(key, field, serializedValue);
    } catch (error) {
      console.error('❌ Redis hSet error:', error.message);
      return 0;
    }
  }

  async hGet(key, field) {
    if (!this.isConnected) {
      console.warn('⚠️ Redis not connected, skipping hGet operation');
      return null;
    }

    try {
      const value = await this.client.hGet(key, field);
      
      if (!value) return null;

      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    } catch (error) {
      console.error('❌ Redis hGet error:', error.message);
      return null;
    }
  }

  async hGetAll(key) {
    if (!this.isConnected) {
      console.warn('⚠️ Redis not connected, skipping hGetAll operation');
      return {};
    }

    try {
      const result = await this.client.hGetAll(key);
      const parsedResult = {};

      for (const [field, value] of Object.entries(result)) {
        try {
          parsedResult[field] = JSON.parse(value);
        } catch {
          parsedResult[field] = value;
        }
      }

      return parsedResult;
    } catch (error) {
      console.error('❌ Redis hGetAll error:', error.message);
      return {};
    }
  }

  async hDel(key, field) {
    if (!this.isConnected) {
      console.warn('⚠️ Redis not connected, skipping hDel operation');
      return 0;
    }

    try {
      return await this.client.hDel(key, field);
    } catch (error) {
      console.error('❌ Redis hDel error:', error.message);
      return 0;
    }
  }

  async publish(channel, message) {
    if (!this.isConnected) {
      console.warn('⚠️ Redis not connected, skipping publish operation');
      return 0;
    }

    try {
      const serializedMessage = typeof message === 'object' ? JSON.stringify(message) : message;
      return await this.client.publish(channel, serializedMessage);
    } catch (error) {
      console.error('❌ Redis publish error:', error.message);
      return 0;
    }
  }

  async subscribe(channel, callback) {
    if (!this.isConnected) {
      console.warn('⚠️ Redis not connected, skipping subscribe operation');
      return;
    }

    try {
      const subscriber = this.client.duplicate();
      await subscriber.connect();

      await subscriber.subscribe(channel, (message) => {
        try {
          const parsedMessage = JSON.parse(message);
          callback(parsedMessage, channel);
        } catch {
          callback(message, channel);
        }
      });

      return subscriber;
    } catch (error) {
      console.error('❌ Redis subscribe error:', error.message);
    }
  }

  async ping() {
    if (!this.isConnected) {
      return 'Redis not connected';
    }

    try {
      return await this.client.ping();
    } catch (error) {
      console.error('❌ Redis ping error:', error.message);
      return 'Error';
    }
  }

  async getStatus() {
    return {
      connected: this.isConnected,
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    };
  }

  // Método para cerrar la conexión gracefully
  async disconnect() {
    if (this.client && this.isConnected) {
      try {
        await this.client.quit();
        console.log('✅ Redis: Disconnected gracefully');
      } catch (error) {
        console.error('❌ Error disconnecting from Redis:', error.message);
      }
    }
  }
}

// Crear instancia única (Singleton)
const redisClient = new RedisClient();

// Manejar cierre graceful de la aplicación
process.on('SIGINT', async () => {
  await redisClient.disconnect();
});

process.on('SIGTERM', async () => {
  await redisClient.disconnect();
});

export default redisClient;