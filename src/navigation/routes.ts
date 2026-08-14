export type Screen =
  | 'login'
  | 'onboarding'
  | 'home'
  | 'run'
  | 'complete'
  | 'discover'
  | 'request'
  | 'profile'
  | 'account'
  | 'chat'
  | 'chatThread'
  | 'report';

export type MainTab = Extract<Screen, 'home' | 'discover' | 'profile'>;

export const screensWithBottomNavigation = new Set<Screen>([
  'home',
  'complete',
  'discover',
  'profile',
]);
