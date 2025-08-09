// Swagger/OpenAPI configuration for ordr.fm API documentation
const swaggerJsdoc = require('swagger-jsdoc');
const config = require('./index');

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'ordr.fm API',
            version: '2.5.0',
            description: 'Comprehensive API for the ordr.fm music organization system',
            contact: {
                name: 'ordr.fm Development Team',
                url: 'https://github.com/adrianwedd/ordr.fm'
            },
            license: {
                name: 'MIT',
                url: 'https://github.com/adrianwedd/ordr.fm/blob/main/LICENSE'
            }
        },
        servers: [
            {
                url: `http://localhost:${config.PORT}`,
                description: 'Development server'
            },
            {
                url: 'https://ordr-fm.example.com',
                description: 'Production server'
            }
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                    description: 'JWT token obtained from /api/auth/login'
                }
            },
            schemas: {
                Album: {
                    type: 'object',
                    required: ['id', 'album_title', 'album_artist'],
                    properties: {
                        id: {
                            type: 'integer',
                            description: 'Unique album identifier'
                        },
                        album_title: {
                            type: 'string',
                            description: 'Album title'
                        },
                        album_artist: {
                            type: 'string',
                            description: 'Album artist name'
                        },
                        album_year: {
                            type: 'integer',
                            description: 'Release year'
                        },
                        genre: {
                            type: 'string',
                            description: 'Musical genre'
                        },
                        quality: {
                            type: 'string',
                            enum: ['Lossless', 'Lossy', 'Mixed'],
                            description: 'Audio quality classification'
                        },
                        track_count: {
                            type: 'integer',
                            description: 'Number of tracks in album'
                        },
                        total_duration: {
                            type: 'integer',
                            description: 'Total duration in seconds'
                        },
                        file_path: {
                            type: 'string',
                            description: 'File system path to album'
                        },
                        label: {
                            type: 'string',
                            description: 'Record label'
                        },
                        catalog_number: {
                            type: 'string',
                            description: 'Catalog number'
                        },
                        discogs_id: {
                            type: 'integer',
                            description: 'Discogs release ID'
                        },
                        created_at: {
                            type: 'string',
                            format: 'date-time',
                            description: 'Creation timestamp'
                        },
                        last_modified: {
                            type: 'string',
                            format: 'date-time',
                            description: 'Last modification timestamp'
                        }
                    },
                    example: {
                        id: 1,
                        album_title: 'Selected Ambient Works 85-92',
                        album_artist: 'Aphex Twin',
                        album_year: 1992,
                        genre: 'Electronic',
                        quality: 'Lossless',
                        track_count: 13,
                        total_duration: 4608,
                        file_path: '/music/Electronic/Aphex Twin/Selected Ambient Works 85-92 (1992)',
                        label: 'R&S Records',
                        catalog_number: 'RS 9206 CD',
                        discogs_id: 9689,
                        created_at: '2024-01-15T10:30:00Z',
                        last_modified: '2024-01-15T10:30:00Z'
                    }
                },
                Track: {
                    type: 'object',
                    required: ['id', 'track_title', 'track_number'],
                    properties: {
                        id: {
                            type: 'integer',
                            description: 'Unique track identifier'
                        },
                        track_title: {
                            type: 'string',
                            description: 'Track title'
                        },
                        track_artist: {
                            type: 'string',
                            description: 'Track artist (if different from album artist)'
                        },
                        track_number: {
                            type: 'integer',
                            description: 'Track number on album'
                        },
                        disc_number: {
                            type: 'integer',
                            description: 'Disc number for multi-disc albums'
                        },
                        duration: {
                            type: 'integer',
                            description: 'Track duration in seconds'
                        },
                        file_format: {
                            type: 'string',
                            enum: ['MP3', 'FLAC', 'WAV', 'AIFF', 'M4A', 'OGG'],
                            description: 'Audio file format'
                        },
                        quality: {
                            type: 'string',
                            description: 'Audio quality details'
                        },
                        file_name: {
                            type: 'string',
                            description: 'Original file name'
                        },
                        file_path: {
                            type: 'string',
                            description: 'Full file system path'
                        }
                    },
                    example: {
                        id: 1,
                        track_title: 'Xtal',
                        track_number: 1,
                        disc_number: 1,
                        duration: 284,
                        file_format: 'FLAC',
                        quality: 'Lossless',
                        file_name: '01 - Xtal.flac'
                    }
                },
                User: {
                    type: 'object',
                    required: ['id', 'username'],
                    properties: {
                        id: {
                            type: 'integer',
                            description: 'Unique user identifier'
                        },
                        username: {
                            type: 'string',
                            description: 'Username'
                        },
                        email: {
                            type: 'string',
                            format: 'email',
                            description: 'User email address'
                        },
                        role: {
                            type: 'string',
                            enum: ['user', 'admin'],
                            description: 'User role'
                        },
                        created_at: {
                            type: 'string',
                            format: 'date-time',
                            description: 'Account creation timestamp'
                        },
                        last_login: {
                            type: 'string',
                            format: 'date-time',
                            description: 'Last login timestamp'
                        }
                    },
                    example: {
                        id: 1,
                        username: 'music_admin',
                        email: 'admin@example.com',
                        role: 'admin',
                        created_at: '2024-01-01T00:00:00Z',
                        last_login: '2024-01-15T15:30:00Z'
                    }
                },
                PaginatedResponse: {
                    type: 'object',
                    properties: {
                        pagination: {
                            type: 'object',
                            properties: {
                                page: {
                                    type: 'integer',
                                    description: 'Current page number'
                                },
                                pageSize: {
                                    type: 'integer',
                                    description: 'Number of items per page'
                                },
                                total: {
                                    type: 'integer',
                                    description: 'Total number of items'
                                },
                                totalPages: {
                                    type: 'integer',
                                    description: 'Total number of pages'
                                },
                                hasNext: {
                                    type: 'boolean',
                                    description: 'Whether there is a next page'
                                },
                                hasPrev: {
                                    type: 'boolean',
                                    description: 'Whether there is a previous page'
                                }
                            }
                        }
                    }
                },
                Error: {
                    type: 'object',
                    required: ['error'],
                    properties: {
                        error: {
                            type: 'string',
                            description: 'Error message'
                        },
                        code: {
                            type: 'string',
                            description: 'Error code'
                        },
                        details: {
                            type: 'object',
                            description: 'Additional error details'
                        }
                    },
                    example: {
                        error: 'Album not found',
                        code: 'ALBUM_NOT_FOUND'
                    }
                }
            }
        },
        security: [
            {
                bearerAuth: []
            }
        ]
    },
    apis: [
        './src/controllers/*.js', // Controllers with JSDoc annotations
        './server.js' // Main server file
    ]
};

// Create Swagger specification
const swaggerSpec = swaggerJsdoc(options);

module.exports = {
    swaggerSpec,
    swaggerOptions: {
        explorer: true,
        customCss: `
            .swagger-ui .topbar { display: none; }
            .swagger-ui .info .title { color: #2c5aa0; }
            .swagger-ui .scheme-container { background: #f8f9fa; padding: 10px; margin-bottom: 20px; border-radius: 5px; }
        `,
        customSiteTitle: 'ordr.fm API Documentation',
        customfavIcon: '/icons/favicon.ico'
    }
};