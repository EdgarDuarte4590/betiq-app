import { create } from 'zustand';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js';

export interface BetDraft {
  match: string;
  odds: string;
  stake: string;
  sport: string;
  league: string;
  pick: string;
  market?: string;
  matchTime?: string;
  sportKey?: string;
  confidence?: string;
  kellyPct?: number;
  fairOdds?: number;
  units?: number;
  isSteamMove?: boolean;
}

interface BankrollState {
  bankroll: number;
  pendingExposure: number; // Total comprometido en apuestas PENDING para Simultaneous Kelly
  loading: boolean;
  isModalOpen: boolean;
  draftBet: BetDraft | null;
  user: User | null;

  openModal: (draft?: Partial<BetDraft>) => void;
  closeModal: () => void;
  setBankroll: (amount: number) => void;
  setPendingExposure: (amount: number) => void;
  syncWithSupabase: () => Promise<void>;
  updateBankrollInDB: (newAmount: number, addedPendingStake?: number) => Promise<void>;
  logout: () => Promise<void>;
}

const supabase = createClient();

export const useBankrollStore = create<BankrollState>((set, get) => ({
  bankroll: 0,
  pendingExposure: 0,
  loading: true,
  isModalOpen: false,
  draftBet: null,
  user: null,

  openModal: (draft) => set({
    isModalOpen: true,
    draftBet: draft ? {
      match: draft.match || '',
      odds: draft.odds || '2.00',
      stake: draft.stake || '20',
      sport: draft.sport || '',
      league: draft.league || '',
      pick: draft.pick || '',
      market: draft.market || '',
      matchTime: draft.matchTime || '',
      sportKey: draft.sportKey || '',
      confidence: draft.confidence || '',
      kellyPct: draft.kellyPct,
      fairOdds: draft.fairOdds,
      units: draft.units,
      isSteamMove: draft.isSteamMove,
    } : null
  }),

  closeModal: () => set({ isModalOpen: false, draftBet: null }),

  setBankroll: (amount) => set({ bankroll: amount }),
  setPendingExposure: (amount) => set({ pendingExposure: amount }),

  syncWithSupabase: async () => {
    set({ loading: true });

    const { data: { session } } = await supabase.auth.getSession();

    if (session?.user) {
      set({ user: session.user });

      const [profileRes, pendingRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('bankroll_actual')
          .eq('id', session.user.id)
          .single(),
        supabase
          .from('bets')
          .select('stake')
          .eq('user_id', session.user.id)
          .eq('status', 'pending'),
      ]);

      const pendingTotal = (pendingRes.data ?? []).reduce(
        (sum, b: any) => sum + parseFloat(String(b.stake || '0')),
        0
      );

      if (profileRes.data) {
        set({
          bankroll: parseFloat(profileRes.data.bankroll_actual),
          pendingExposure: Number(pendingTotal.toFixed(2)),
          loading: false,
        });
      } else {
        set({ pendingExposure: Number(pendingTotal.toFixed(2)), loading: false });
      }
    } else {
      set({ user: null, pendingExposure: 0, loading: false });
    }
  },

  updateBankrollInDB: async (newAmount: number, addedPendingStake: number = 0) => {
    const { user, pendingExposure } = get();
    if (!user) return;

    const { error } = await supabase
      .from('profiles')
      .update({ bankroll_actual: newAmount })
      .eq('id', user.id);

    if (!error) {
      set({
        bankroll: newAmount,
        pendingExposure: Math.max(0, Number((pendingExposure + addedPendingStake).toFixed(2))),
      });
    }
  },

  logout: async () => {
    await supabase.auth.signOut();
    set({ user: null, bankroll: 0, pendingExposure: 0 });
    window.location.href = '/login';
  }
}));
