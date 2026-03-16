// Mock react-native for Jest — only the pieces our code actually imports

export const AppState = {
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  currentState: 'active' as string,
};

export const PixelRatio = {
  get: jest.fn(() => 2),
};

export const StyleSheet = {
  create: jest.fn((styles: any) => styles),
  absoluteFill: {},
};

export const View = 'View';
export const Text = 'Text';

export type NativeSyntheticEvent<T> = { nativeEvent: T };
export type AppStateStatus = 'active' | 'background' | 'inactive';
