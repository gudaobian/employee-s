module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test', '<rootDir>/common', '<rootDir>/main', '<rootDir>/platforms'],
  testMatch: [
    '**/__tests__/**/*.ts',
    '**/?(*.)+(spec|test).ts'
  ],
  transform: {
    '^.+\\.ts$': 'ts-jest'
  },
  collectCoverageFrom: [
    'common/**/*.ts',
    'main/**/*.ts',
    'platforms/**/*.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/dist/**',
    '!**/test/**',
    '!**/*.test.ts',
    '!**/*.benchmark.ts'
  ],
  moduleNameMapper: {
    '^@common/(.*)$': '<rootDir>/common/$1',
    '^@platforms/(.*)$': '<rootDir>/platforms/$1',
    '^@main/(.*)$': '<rootDir>/main/$1'
  },
  modulePathIgnorePatterns: [
    '<rootDir>/release/',
    '<rootDir>/dist/',
    '<rootDir>/native-event-monitor/node_modules',
    '<rootDir>/native-event-monitor-win/node_modules'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/release/',
    '/dist/',
    '/test/performance/'
  ],
  globals: {
    'ts-jest': {
      tsconfig: {
        esModuleInterop: true,
        allowSyntheticDefaultImports: true
      }
    }
  },
  testTimeout: 60000,
  maxWorkers: 1,
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 80,
      statements: 80
    }
  }
};
