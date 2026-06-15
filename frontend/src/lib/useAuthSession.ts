/**
 * useAuthSession — shared auth-session resolution for patient + doctor shells.
 *
 * Encapsulates: synchronous ZkLoginSession.restore() on init, non-wallet address
 * state (zkLogin/passkey), merge with the connected browser-wallet address, and
 * a logout() that clears all three session kinds and reverts to WalletSession.
 *
 * NOTE: PatientShell also has a useEffect that watches walletAccount to keep
 * WalletSession in sync. That effect is a no-op in practice (WalletSession reads
 * dAppKit stores live), so it is intentionally omitted here. Task 7 reconciliation
 * can add it back if needed.
 */

import { useState } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit-react';
import { getPatientSession, setPatientSession, WalletSession } from './patientSession';
import { ZkLoginSession, clearZkLoginSession } from './zkLoginSession';
import { clearPasskeySession } from './passkeySession';

export interface AuthSession {
  authMethod: 'wallet' | 'zklogin' | 'passkey';
  activeAddress: string | null;
  isAuthenticated: boolean;
  /** True only for zkLogin/passkey (drives the custom badge/controls vs ConnectButton). */
  isNonWallet: boolean;
  /** AuthLogin onSessionReady callback. */
  onSessionReady: () => void;
  logout: () => void;
}

export function useAuthSession(): AuthSession {
  const walletAccount = useCurrentAccount();

  // Non-wallet session state (zkLogin or passkey)
  const [nonWalletAddress, setNonWalletAddress] = useState<string | null>(() => {
    // Restore zkLogin session synchronously if available
    const zk = ZkLoginSession.restore();
    if (zk) {
      setPatientSession(zk);
      return zk.getAddress();
    }
    return null;
  });

  function onSessionReady() {
    const s = getPatientSession();
    if (s.authMethod !== 'wallet') {
      setNonWalletAddress(s.getAddress());
    }
  }

  function logout() {
    clearZkLoginSession();
    clearPasskeySession();
    setPatientSession(new WalletSession());
    setNonWalletAddress(null);
  }

  const activeAddress = nonWalletAddress ?? walletAccount?.address ?? null;
  const session = getPatientSession();

  return {
    authMethod: session.authMethod,
    activeAddress,
    isAuthenticated: activeAddress !== null,
    isNonWallet: nonWalletAddress !== null,
    onSessionReady,
    logout,
  };
}
