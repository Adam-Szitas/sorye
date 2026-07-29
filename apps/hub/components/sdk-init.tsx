'use client';

import { useEffect } from 'react';

/** Registers Lit web components once on the client (after mount). */
export function SdkInit() {
  useEffect(() => {
    void import('@sorye/sdk/register');
  }, []);

  return null;
}
