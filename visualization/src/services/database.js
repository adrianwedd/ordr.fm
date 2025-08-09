// Database service for SQLite operations
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { DB_PATH, isTest } = require('../config');
const cacheManager = require('../utils/cache');

class DatabaseService {
    constructor() {
        this.db = null;
        this.isConnected = false;
    }

    /**
     * Initialize database connection
     * @returns {Promise<void>}
     */
    async connect() {
        return new Promise((resolve, reject) => {
            const dbPath = isTest() ? ':memory:' : DB_PATH;
            
            this.db = new sqlite3.Database(dbPath, (err) => {
                if (err) {
                    console.error('Database connection error:', err);
                    reject(err);
                } else {
                    console.log('Connected to SQLite database:', dbPath);
                    this.isConnected = true;
                    resolve();
                }
            });
        });
    }

    /**
     * Close database connection
     * @returns {Promise<void>}
     */
    async disconnect() {
        if (!this.db) return;

        return new Promise((resolve) => {
            this.db.close((err) => {
                if (err) {
                    console.error('Error closing database:', err);
                } else {
                    console.log('Database connection closed');
                }
                this.isConnected = false;
                resolve();
            });
        });
    }

    /**
     * Execute a query with caching support
     * @param {string} sql - SQL query
     * @param {Array} params - Query parameters
     * @param {boolean} useCache - Whether to use caching
     * @returns {Promise<Array>}
     */
    async query(sql, params = [], useCache = true) {
        if (!this.isConnected) {
            throw new Error('Database not connected');
        }

        const cacheKey = useCache ? cacheManager.getCacheKey(sql, params) : null;
        
        // Check cache first
        if (cacheKey) {
            const cached = cacheManager.getCache(cacheKey);
            if (cached) {
                return cached;
            }
        }

        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    console.error('Database query error:', err);
                    reject(err);
                } else {
                    // Cache the result
                    if (cacheKey) {
                        cacheManager.setCache(cacheKey, rows);
                    }
                    resolve(rows);
                }
            });
        });
    }

    /**
     * Execute a query and return first row only
     * @param {string} sql - SQL query
     * @param {Array} params - Query parameters
     * @param {boolean} useCache - Whether to use caching
     * @returns {Promise<Object|null>}
     */
    async queryOne(sql, params = [], useCache = true) {
        const rows = await this.query(sql, params, useCache);
        return rows.length > 0 ? rows[0] : null;
    }

    /**
     * Execute a non-SELECT query (INSERT, UPDATE, DELETE)
     * @param {string} sql - SQL query
     * @param {Array} params - Query parameters
     * @returns {Promise<Object>} Result with lastID, changes
     */
    async run(sql, params = []) {
        if (!this.isConnected) {
            throw new Error('Database not connected');
        }

        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    console.error('Database run error:', err);
                    reject(err);
                } else {
                    resolve({
                        lastID: this.lastID,
                        changes: this.changes
                    });
                }
            });
        });
    }

    /**
     * Get database statistics
     * @returns {Promise<Object>}
     */
    async getStats() {
        try {
            const tables = await this.query(`
                SELECT name FROM sqlite_master 
                WHERE type='table' AND name NOT LIKE 'sqlite_%'
            `, [], false);

            const stats = {
                tables: [],
                totalRows: 0
            };

            for (const table of tables) {
                const countResult = await this.query(
                    `SELECT COUNT(*) as count FROM ${table.name}`, 
                    [], 
                    false
                );
                const count = countResult[0].count;
                
                stats.tables.push({
                    name: table.name,
                    rows: count
                });
                stats.totalRows += count;
            }

            return stats;
        } catch (error) {
            console.error('Error getting database stats:', error);
            return { tables: [], totalRows: 0, error: error.message };
        }
    }

    /**
     * Begin transaction
     */
    async beginTransaction() {
        await this.run('BEGIN TRANSACTION');
    }

    /**
     * Commit transaction
     */
    async commitTransaction() {
        await this.run('COMMIT');
    }

    /**
     * Rollback transaction
     */
    async rollbackTransaction() {
        await this.run('ROLLBACK');
    }

    /**
     * Execute multiple queries in a transaction
     * @param {Array} queries - Array of {sql, params} objects
     * @returns {Promise<Array>} Results array
     */
    async transaction(queries) {
        const results = [];
        
        try {
            await this.beginTransaction();
            
            for (const query of queries) {
                const result = await this.run(query.sql, query.params);
                results.push(result);
            }
            
            await this.commitTransaction();
            return results;
        } catch (error) {
            await this.rollbackTransaction();
            throw error;
        }
    }
}

// Export singleton instance
const databaseService = new DatabaseService();
module.exports = databaseService;