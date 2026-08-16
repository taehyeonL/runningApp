import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

import { errorMessage } from '../lib/errors';
import { supabase } from '../lib/supabase';

export function useAuthSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(supabase));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setIsLoading(false);
      return;
    }

    let mounted = true;
    void supabase.auth.getSession()
      .then(({ data, error: sessionError }) => {
        if (!mounted) return;
        setSession(sessionError ? null : data.session);
        setError(sessionError?.message ?? null);
        setIsLoading(false);
      })
      .catch((sessionError: unknown) => {
        if (!mounted) return;
        setSession(null);
        setError(errorMessage(sessionError, '로그인 세션을 복원하지 못했습니다.'));
        setIsLoading(false);
      });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      setError(null);
      setIsLoading(false);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  return { session, isLoading, error };
}
