// Authentication controller
const { generateToken, hashPassword, verifyPassword } = require('../utils/auth');
const databaseService = require('../services/database');

class AuthController {
    /**
     * @swagger
     * /api/auth/login:
     *   post:
     *     summary: User authentication
     *     description: Authenticate user with username and password, returns JWT token for authorized access.
     *     tags: [Authentication]
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required: [username, password]
     *             properties:
     *               username:
     *                 type: string
     *                 description: User's username
     *               password:
     *                 type: string
     *                 format: password
     *                 description: User's password
     *             example:
     *               username: admin
     *               password: secretpassword
     *     responses:
     *       200:
     *         description: Login successful
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 token:
     *                   type: string
     *                   description: JWT authentication token
     *                 user:
     *                   $ref: '#/components/schemas/User'
     *               example:
     *                 token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
     *                 user:
     *                   id: 1
     *                   username: admin
     *                   role: admin
     *                   email: admin@example.com
     *       400:
     *         description: Missing username or password
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       401:
     *         description: Invalid credentials
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *       500:
     *         description: Internal server error
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/Error'
     *     security: []
     */
    async login(req, res) {
        try {
            const { username, password } = req.body;

            if (!username || !password) {
                return res.status(400).json({
                    error: 'Username and password are required'
                });
            }

            // Get user from database
            const user = await databaseService.queryOne(
                'SELECT * FROM users WHERE username = ?',
                [username]
            );

            if (!user) {
                return res.status(401).json({
                    error: 'Invalid credentials'
                });
            }

            // Verify password
            const isValidPassword = await verifyPassword(password, user.password_hash);
            
            if (!isValidPassword) {
                return res.status(401).json({
                    error: 'Invalid credentials'
                });
            }

            // Update last login
            await databaseService.run(
                'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
                [user.id]
            );

            // Generate token
            const token = generateToken({
                userId: user.id,
                username: user.username,
                role: user.role || 'user'
            });

            res.json({
                token,
                user: {
                    id: user.id,
                    username: user.username,
                    role: user.role || 'user',
                    email: user.email,
                    lastLogin: new Date().toISOString()
                }
            });

        } catch (error) {
            console.error('Login error:', error);
            res.status(500).json({
                error: 'Internal server error during login'
            });
        }
    }

    /**
     * User logout
     */
    async logout(req, res) {
        // In a stateless JWT system, logout is handled client-side
        // But we can log the logout event
        try {
            const { userId } = req.user;
            
            // Log logout event (optional)
            await databaseService.run(
                'INSERT INTO user_activity (user_id, action, timestamp) VALUES (?, ?, CURRENT_TIMESTAMP)',
                [userId, 'logout']
            ).catch(() => {
                // Ignore if table doesn't exist
            });

            res.json({
                message: 'Logged out successfully'
            });

        } catch (error) {
            console.error('Logout error:', error);
            res.status(500).json({
                error: 'Internal server error during logout'
            });
        }
    }

    /**
     * Get user profile
     */
    async getProfile(req, res) {
        try {
            const { userId } = req.user;

            const user = await databaseService.queryOne(
                'SELECT id, username, email, role, created_at, last_login FROM users WHERE id = ?',
                [userId]
            );

            if (!user) {
                return res.status(404).json({
                    error: 'User not found'
                });
            }

            res.json({
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    role: user.role || 'user',
                    createdAt: user.created_at,
                    lastLogin: user.last_login
                }
            });

        } catch (error) {
            console.error('Get profile error:', error);
            res.status(500).json({
                error: 'Internal server error while fetching profile'
            });
        }
    }

    /**
     * Create new user (admin only)
     */
    async createUser(req, res) {
        try {
            const { username, email, password, role = 'user' } = req.body;

            if (!username || !email || !password) {
                return res.status(400).json({
                    error: 'Username, email, and password are required'
                });
            }

            // Check if user already exists
            const existingUser = await databaseService.queryOne(
                'SELECT id FROM users WHERE username = ? OR email = ?',
                [username, email]
            );

            if (existingUser) {
                return res.status(409).json({
                    error: 'Username or email already exists'
                });
            }

            // Hash password
            const passwordHash = await hashPassword(password);

            // Create user
            const result = await databaseService.run(
                `INSERT INTO users (username, email, password_hash, role, created_at) 
                 VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [username, email, passwordHash, role]
            );

            res.status(201).json({
                message: 'User created successfully',
                userId: result.lastID
            });

        } catch (error) {
            console.error('Create user error:', error);
            res.status(500).json({
                error: 'Internal server error while creating user'
            });
        }
    }

    /**
     * Get all users (admin only)
     */
    async getUsers(req, res) {
        try {
            const users = await databaseService.query(
                'SELECT id, username, email, role, created_at, last_login FROM users ORDER BY username'
            );

            res.json({
                users: users.map(user => ({
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    role: user.role || 'user',
                    createdAt: user.created_at,
                    lastLogin: user.last_login
                }))
            });

        } catch (error) {
            console.error('Get users error:', error);
            res.status(500).json({
                error: 'Internal server error while fetching users'
            });
        }
    }
}

module.exports = new AuthController();