export function pidLock(file: string, options?: { waitMs?: number }): (() => void) | undefined;
