/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  globals: {
    // React Native defines this at runtime; example-app sources reference it.
    __DEV__: true,
  },
  roots: ['<rootDir>/src', '<rootDir>/examples/dungeon-dash/__tests__'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
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
        // Example-app sources import the library by its package name; map it
        // to source for type resolution (moduleNameMapper covers runtime).
        baseUrl: '.',
        paths: { 'react-native-nitro-godot': ['./src/index.ts'] },
      },
    }],
  },
  // Mock native modules that can't run in Node.js
  moduleNameMapper: {
    // Force a single React copy — example-app sources would otherwise resolve
    // react@19 from examples/dungeon-dash/node_modules while the test renderer
    // uses the root react@18 (mismatched $$typeof breaks rendering).
    '^react$': '<rootDir>/node_modules/react',
    '^react-test-renderer$': '<rootDir>/node_modules/react-test-renderer',
    '^@legendapp/state$': '<rootDir>/node_modules/@legendapp/state',
    '^@legendapp/state/(.*)$': '<rootDir>/node_modules/@legendapp/state/$1',
    '^react-native$': '<rootDir>/src/__tests__/__mocks__/react-native.ts',
    '^react-native-nitro-modules$': '<rootDir>/src/__tests__/__mocks__/react-native-nitro-modules.ts',
    // Example-app tests resolve the library to its source
    '^react-native-nitro-godot$': '<rootDir>/src/index.ts',
    '^expo-asset$': '<rootDir>/examples/dungeon-dash/__tests__/__mocks__/expo-asset.ts',
    '^expo-file-system$': '<rootDir>/examples/dungeon-dash/__tests__/__mocks__/expo-file-system.ts',
    '^react-native-gesture-handler$': '<rootDir>/examples/dungeon-dash/__tests__/__mocks__/react-native-gesture-handler.ts',
    '\\.(pck|png|jpg)$': '<rootDir>/examples/dungeon-dash/__tests__/__mocks__/assetStub.js',
  },
};
