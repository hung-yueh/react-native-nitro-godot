/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        // Override verbatimModuleSyntax for Jest compatibility
        verbatimModuleSyntax: false,
        // Use CommonJS for Jest
        module: 'commonjs',
        moduleResolution: 'node',
        jsx: 'react',
      },
    }],
  },
  // Mock native modules that can't run in Node.js
  moduleNameMapper: {
    '^react-native$': '<rootDir>/src/__tests__/__mocks__/react-native.ts',
    '^react-native-nitro-modules$': '<rootDir>/src/__tests__/__mocks__/react-native-nitro-modules.ts',
  },
};
