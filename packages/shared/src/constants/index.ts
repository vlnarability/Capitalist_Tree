export * from './provisional';
// W73 (2026-11-25): constants promoted from provisional → decided after DR-1
// + long-horizon validation (structural/foundational only). provisional.ts
// re-exports each under its old PROVISIONAL_ name for backward compat.
export * from './decided';
export * from './biology';
export * from './resources';
export * from './economy';
export * from './offline';
export * from './environment';
export * from './business';
export * from './progression';
// P10a: EventSystem provisional constants (TDD §6.4, GDD §10/§148-152/§404-408).
export * from './events';
