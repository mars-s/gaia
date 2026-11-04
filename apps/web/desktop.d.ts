export {};

declare global {
  interface Window {
    gaiaDesktop?: {
      readonly platform: string;
      openAuth(url: string): Promise<void>;
    };
  }
}
