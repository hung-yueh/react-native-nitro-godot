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
  absoluteFillObject: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  flatten: jest.fn((...args: any[]) => Object.assign({}, ...args.flat())),
};

export const Platform = {
  OS: 'ios' as string,
  select: jest.fn((obj: any) => obj.ios ?? obj.default),
};

// StatusBar is used both as a component (<StatusBar barStyle=... />) and as a
// value (StatusBar.currentHeight) — model both.
export const StatusBar: any = () => null;
StatusBar.currentHeight = 24;

export const View = 'View';
export const Text = 'Text';
export const TouchableOpacity = 'TouchableOpacity';
export const ScrollView = 'ScrollView';

class AnimatedValue {
  _value: number;
  constructor(v: number) {
    this._value = v;
  }
  setValue(_v: number) {}
  interpolate(_cfg: any) {
    return this;
  }
}

export const Animated = {
  View: 'Animated.View',
  Text: 'Animated.Text',
  Value: AnimatedValue,
  timing: (_v: any, _cfg: any) => ({ start: (cb?: () => void) => cb?.() }),
  loop: (_a: any) => ({ start() {}, stop() {} }),
  sequence: (_a: any[]) => ({ start: (cb?: () => void) => cb?.() }),
  delay: (_ms: number) => ({ start: (cb?: () => void) => cb?.() }),
};

export const Easing = {
  linear: (t: number) => t,
  ease: (t: number) => t,
  inOut: (fn: any) => fn,
  bezier: () => (t: number) => t,
};

export const requireNativeComponent = jest.fn((name: string) => name);

export type NativeSyntheticEvent<T> = { nativeEvent: T };
export type ViewProps = { style?: any; children?: any; [key: string]: any };
export type ViewStyle = Record<string, any>;
export type AppStateStatus = 'active' | 'background' | 'inactive';
