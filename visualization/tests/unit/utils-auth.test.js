// Unit tests for authentication utilities (now modular)
const { describe, test, expect, beforeEach } = require('@jest/globals');

// Mock bcrypt and jsonwebtoken
const mockBcrypt = {
    hash: jest.fn(),
    compare: jest.fn()
};

const mockJWT = {
    sign: jest.fn(),
    verify: jest.fn()
};

jest.mock('bcrypt', () => mockBcrypt);
jest.mock('jsonwebtoken', () => mockJWT);

// Mock config
jest.mock('../../src/config', () => ({
    JWT_SECRET: 'test-secret',
    JWT_EXPIRES_IN: '24h',
    BCRYPT_ROUNDS: 12
}));

// Import the module to test
const { 
    generateToken, 
    verifyToken, 
    hashPassword, 
    verifyPassword,
    extractToken,
    generateRandomPassword
} = require('../../src/utils/auth');

describe('Auth Utils (Modular)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('JWT Operations', () => {
        test('generateToken should create JWT with correct payload', () => {
            const payload = { userId: 1, username: 'testuser' };
            const expectedToken = 'mock.jwt.token';
            
            mockJWT.sign.mockReturnValue(expectedToken);
            
            const token = generateToken(payload);
            
            expect(mockJWT.sign).toHaveBeenCalledWith(payload, 'test-secret', { expiresIn: '24h' });
            expect(token).toBe(expectedToken);
        });

        test('verifyToken should decode valid token', () => {
            const token = 'valid.jwt.token';
            const expectedPayload = { userId: 1, username: 'testuser' };
            
            mockJWT.verify.mockReturnValue(expectedPayload);
            
            const payload = verifyToken(token);
            
            expect(mockJWT.verify).toHaveBeenCalledWith(token, 'test-secret');
            expect(payload).toEqual(expectedPayload);
        });

        test('verifyToken should return null for invalid token', () => {
            const invalidToken = 'invalid.jwt.token';
            
            mockJWT.verify.mockImplementation(() => {
                throw new Error('Invalid token');
            });
            
            const payload = verifyToken(invalidToken);
            
            expect(payload).toBeNull();
        });
    });

    describe('Password Operations', () => {
        test('hashPassword should hash password with correct rounds', async () => {
            const password = 'testpassword123';
            const hashedPassword = '$2b$12$hashedpasswordstring';
            
            mockBcrypt.hash.mockResolvedValue(hashedPassword);
            
            const result = await hashPassword(password);
            
            expect(mockBcrypt.hash).toHaveBeenCalledWith(password, 12);
            expect(result).toBe(hashedPassword);
        });

        test('verifyPassword should return true for matching password', async () => {
            const password = 'testpassword123';
            const hash = '$2b$12$hashedpasswordstring';
            
            mockBcrypt.compare.mockResolvedValue(true);
            
            const isValid = await verifyPassword(password, hash);
            
            expect(mockBcrypt.compare).toHaveBeenCalledWith(password, hash);
            expect(isValid).toBe(true);
        });

        test('verifyPassword should return false for non-matching password', async () => {
            const password = 'wrongpassword';
            const hash = '$2b$12$hashedpasswordstring';
            
            mockBcrypt.compare.mockResolvedValue(false);
            
            const isValid = await verifyPassword(password, hash);
            
            expect(isValid).toBe(false);
        });
    });

    describe('Token Extraction', () => {
        test('extractToken should extract token from Bearer header', () => {
            const authHeader = 'Bearer abc123.def456.ghi789';
            
            const token = extractToken(authHeader);
            
            expect(token).toBe('abc123.def456.ghi789');
        });

        test('extractToken should return null for invalid header', () => {
            expect(extractToken('Invalid header')).toBeNull();
            expect(extractToken('')).toBeNull();
            expect(extractToken(null)).toBeNull();
            expect(extractToken(undefined)).toBeNull();
        });
    });

    describe('Password Generation', () => {
        test('generateRandomPassword should create password of correct length', () => {
            const password = generateRandomPassword(12);
            
            expect(typeof password).toBe('string');
            expect(password.length).toBe(12);
        });

        test('generateRandomPassword should use default length', () => {
            const password = generateRandomPassword();
            
            expect(password.length).toBe(12);
        });

        test('generateRandomPassword should create different passwords', () => {
            const password1 = generateRandomPassword(16);
            const password2 = generateRandomPassword(16);
            
            expect(password1).not.toBe(password2);
            expect(password1.length).toBe(16);
            expect(password2.length).toBe(16);
        });
    });
});