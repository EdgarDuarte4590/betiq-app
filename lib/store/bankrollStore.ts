import { create } from 'zustand';
import { createClient } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js';

interface BetDraft {
  match: string;
  odds: string;
  stake: string;
  sport: string;
  league: string;
  pick: string;
  matchTime?: string;
  sportKey?: string;
  confidence?: string;
}

interface BankrollState {
  bankroll: number;
  loading: boolean;
  isModalOpen: boolean;
  draftBet: BetDraft | null;
  user: User | null;
  
  openModal: (draft?: Partial<BetDraft>) => void;
  closeModal: () => void;
  setBankroll: (amount: number) => void;
  syncWithSupabase: () => Promise<void>;
  updateBankrollInDB: (newAmount: number) => Promise<void>;
  logout: () => Promise<void>;
}

const supabase = createClient();

export const useBankrollStore = create<BankrollState>((set, get) => ({
  bankroll: 0,
  loading: true,
  isModalOpen: false,
  draftBet: null,
  user: null,
  
  openModal: (draft) => set({ 
    isModalOpen: true, 
    draftBet: draft ? {
      match: draft.match || '',
      odds: draft.odds || '2.00',
      stake: draft.stake || '50',
      sport: draft.sport || '',
      league: draft.league || '',
      pick: draft.pick || '',
      matchTime: draft.matchTime || '',
      sportKey: draft.sportKey || '',
      confidence: draft.confidence || ''
    } : null 
  }),
  
  closeModal: () => set({ isModalOpen: false, draftBet: null }),
  
  setBankroll: (amount) => set({ bankroll: amount }),

  syncWithSupabase: async () => {
    set({ loading: true });
    
    const { data: { session } } = await supabase.auth.getSession();
    
    if (session?.user) {
      set({ user: session.user });
      
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('bankroll_actual')
        .eq('id', session.user.id)
        .single();
        
      if (profile) {
        set({ bankroll: parseFloat(profile.bankroll_actual), loading: false });
      } else {
        set({ loading: false });
      }
    } else {
      set({ user: null, loading: false });
    }
  },

  updateBankrollInDB: async (newAmount: number) => {
    const { user } = get();
    if (!user) return;

    const { error } = await supabase
      .from('profiles')
      .update({ bankroll_actual: newAmount })
      .eq('id', user.id);

    if (!error) {
      set({ bankroll: newAmount });
    }
  },

  logout: async () => {
    await supabase.auth.signOut();
    set({ user: null, bankroll: 0 });
    window.location.href = '/login';
  }
}));

