// Mock expo-file-system (SDK 54+ File/Paths API) for Jest.

export const Paths = {
  document: '/mock/documents',
};

export class File {
  private path: string;
  exists = false;

  constructor(...segments: string[]) {
    this.path = segments.join('/');
  }

  get uri(): string {
    return this.path.startsWith('file://') ? this.path : `file://${this.path}`;
  }

  delete() {}

  copy(_dest: File) {}
}
