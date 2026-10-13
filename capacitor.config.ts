import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'nl.maanhuis.tiefganga',
  appName: 'Tiefgang',
  webDir: 'dist',
  backgroundColor: '#0b0c0e',
  ios: {
    contentInset: 'never',
    scrollEnabled: false,
    backgroundColor: '#0b0c0e',
  },
  android: {
    backgroundColor: '#0b0c0e',
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
      hidden: true,
    },
  },
};

export default config;
