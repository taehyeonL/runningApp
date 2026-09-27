export type Screen =
  | 'login'
  | 'onboarding'
  | 'home'
  | 'run'
  | 'complete'
  | 'plan'
  | 'garden'
  | 'discover'
  | 'friends'
  | 'request'
  | 'profile'
  | 'account'
  | 'chat'
  | 'chatThread'
  | 'report';

export type MainTab = Extract<Screen, 'home' | 'discover' | 'friends' | 'profile'>;

export const screensWithBottomNavigation = new Set<Screen>([
  'home',
  'complete',
  'discover',
  'friends',
  'profile',
]);
