/** @type {import('jest').Config} */
const config = {
  verbose: true,
  testTimeout: 30000,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  collectCoverageFrom: [
    'scripts/**/*.{js,ts}',
    'app/**/*.{ts,tsx}',
    'remotion/**/*.{ts,tsx}',
    '!**/*.test.{js,ts,tsx}',
    '!**/__tests__/**',
    '!**/__mocks__/**',
    '!**/node_modules/**',
  ],

  projects: [
    // ── Node project: scripts + pipeline integration tests ─────────────────
    {
      displayName: 'node',
      testEnvironment: 'node',
      testMatch: [
        '<rootDir>/scripts/**/*.test.{js,ts}',
        '<rootDir>/scripts/__tests__/**/*.{js,ts}',
        '<rootDir>/tests/integration/**/*.test.{js,ts}',
      ],
      transform: {
        '^.+\\.[jt]sx?$': 'babel-jest',
      },
      transformIgnorePatterns: ['node_modules/(?!(sharp)/)'],
      setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/$1',
      },
    },

    // ── React project: app + remotion component tests ──────────────────────
    {
      displayName: 'react',
      testEnvironment: 'jsdom',
      testMatch: [
        '<rootDir>/app/**/*.test.{ts,tsx}',
        '<rootDir>/remotion/**/*.test.{ts,tsx}',
        '<rootDir>/tests/react/**/*.test.{ts,tsx}',
      ],
      transform: {
        // next/babel injects `import React` after the CJS transform; bypass it
        // entirely for jest by disabling .babelrc and using an explicit config.
        '^.+\\.[jt]sx?$': ['babel-jest', {
          babelrc: false,
          configFile: false,
          presets: [
            ['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }],
            ['@babel/preset-react', { runtime: 'automatic' }],
            '@babel/preset-typescript',
          ],
          plugins: ['babel-plugin-transform-import-meta'],
        }],
      },
      transformIgnorePatterns: ['node_modules/'],
      setupFilesAfterEnv: ['<rootDir>/tests/setup.react.ts'],
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/$1',
        '\\.(css|less|scss|sass)$': '<rootDir>/tests/__mocks__/styleMock.js',
        '\\.(gif|ttf|eot|svg|png|jpg|jpeg|webp|mp4|mp3|wav|ogg)$':
          '<rootDir>/tests/__mocks__/fileMock.js',
      },
    },
  ],
};

export default config;
