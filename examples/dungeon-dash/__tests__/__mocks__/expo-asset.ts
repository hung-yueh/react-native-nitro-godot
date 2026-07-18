// Mock expo-asset for Jest — resolves instantly to a local file URI.

export const Asset = {
  fromModule: jest.fn((_module: number) => ({
    downloadAsync: jest.fn(async () => {}),
    localUri: 'file:///mock/bundled/game.pck',
  })),
};
