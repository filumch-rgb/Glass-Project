import { Pool, PoolClient, PoolConfig } from 'pg';
import { config } from './index';
import { loggers } from '../utils/logger';

class Database {
  private pool: Pool;
  private isConnected: boolean = false;

  constructor() {
    const poolConfig: PoolConfig = {
      host: config.database.host,
      port: config.database.port,
      database: config.database.name,
      user: config.database.user,
      password: config.database.password,
      // Connection pool settings
      min: 2, // Minimum number of connections
      max: 10, // Maximum number of connections
      idleTimeoutMillis: 30000, // Close idle connections after 30 seconds
      connectionTimeoutMillis: 2000, // Return error after 2 seconds if connection could not be established
      // SSL configuration for production
      ssl: config.nodeEnv === 'production' ? { rejectUnauthorized: false } : false,
    };

    this.pool = new Pool(poolConfig);

    // Handle pool errors
    this.pool.on('error', (err) => {
      loggers.system.dbError(err);
    });

    // Handle pool connection events
    this.pool.on('connect', () => {
      if (!this.isConnected) {
        loggers.system.dbConnected();
        this.isConnected = true;
      }
    });

    // Handle pool removal events
    this.pool.on('remove', () => {
      loggers.app.debug('Database connection removed from pool');
    });
  }

  /**
   * Test database connection
   */
  async testConnection(): Promise<boolean> {
    try {
      const client = await this.pool.connect();
      const result = await client.query('SELECT NOW() as current_time, version() as version');
      client.release();
      
      loggers.app.info('Database connection test successful', {
        currentTime: result.rows[0].current_time,
        version: result.rows[0].version.split(' ')[0] + ' ' + result.rows[0].version.split(' ')[1]
      });
      
      return true;
    } catch (error) {
      loggers.system.dbError(error as Error);
      return false;
    }
  }

  /**
   * Get a client from the pool
   */
  async getClient(): Promise<PoolClient> {
    try {
      return await this.pool.connect();
    } catch (error) {
      loggers.system.dbError(error as Error);
      throw error;
    }
  }

  /**
   * Execute a query with automatic client management
   */
  async query(text: string, params?: unknown[]): Promise<any> {
    const client = await this.getClient();
    try {
      const start = Date.now();
      const result = await client.query(text, params);
      const duration = Date.now() - start;
      
      loggers.app.debug('Database query executed', {
        query: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        duration,
        rowCount: result.rowCount
      });
      
      return result;
    } catch (error) {
      loggers.app.error('Database query failed', error as Error, {
        query: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        params: params ? '[PARAMS_PROVIDED]' : undefined
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Execute a transaction
   */
  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.getClient();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      loggers.app.error('Database transaction failed', error as Error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Check if database tables exist
   */
  async checkTablesExist(): Promise<boolean> {
    try {
      const requiredTables = [
        'claim_inspections',
        'claim_events',
        'journeys',
        'uploaded_photos',
        'manual_reviews',
        'notification_deliveries'
      ];

      const result = await this.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = ANY($1)
      `, [requiredTables]);

      const existingTables = result.rows.map((row: any) => row.table_name);
      const missingTables = requiredTables.filter(table => !existingTables.includes(table));

      if (missingTables.length > 0) {
        loggers.app.warn('Missing database tables', { missingTables });
        return false;
      }

      loggers.app.info('All required database tables exist');
      return true;
    } catch (error) {
      loggers.system.dbError(error as Error);
      return false;
    }
  }

  /**
   * Get database statistics
   */
  async getStats(): Promise<Record<string, unknown>> {
    try {
      const poolStats = {
        totalCount: this.pool.totalCount,
        idleCount: this.pool.idleCount,
        waitingCount: this.pool.waitingCount,
      };

      const dbStats = await this.query(`
        SELECT 
          schemaname,
          tablename,
          n_tup_ins as inserts,
          n_tup_upd as updates,
          n_tup_del as deletes
        FROM pg_stat_user_tables
        WHERE schemaname = 'public'
      `);

      return {
        pool: poolStats,
        tables: dbStats.rows
      };
    } catch (error) {
      loggers.system.dbError(error as Error);
      return {};
    }
  }

  /**
   * Close all connections
   */
  async close(): Promise<void> {
    try {
      await this.pool.end();
      this.isConnected = false;
      loggers.system.dbDisconnected();
    } catch (error) {
      loggers.system.dbError(error as Error);
    }
  }

  /**
   * Get pool instance (for advanced usage)
   */
  getPool(): Pool {
    return this.pool;
  }
}

// Create singleton instance
export const database = new Database();
export default database;