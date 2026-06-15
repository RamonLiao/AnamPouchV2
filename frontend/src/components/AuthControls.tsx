import { useState } from 'react';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { getFaucetHost, requestSuiFromFaucetV2 } from '@mysten/sui/faucet';
import type { AuthSession } from '../lib/useAuthSession';

const NETWORK = (import.meta.env.VITE_SUI_NETWORK ?? 'testnet') as string;

export function AuthControls({ auth }: { auth: AuthSession }) {
  const [copied, setCopied] = useState(false);
  const [faucetStatus, setFaucetStatus] = useState<'idle' | 'pending' | 'done' | 'error'>('idle');

  const addr = auth.activeAddress;

  function handleCopyAddress() {
    if (!addr) return;
    navigator.clipboard.writeText(addr).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {/* clipboard blocked (insecure context / denied) — no-op */},
    );
  }

  async function handleFaucet() {
    if (!addr || NETWORK === 'mainnet') return;
    setFaucetStatus('pending');
    try {
      await requestSuiFromFaucetV2({
        host: getFaucetHost(NETWORK as 'testnet' | 'devnet' | 'localnet'),
        recipient: addr,
      });
      setFaucetStatus('done');
      setTimeout(() => setFaucetStatus('idle'), 4000);
    } catch {
      setFaucetStatus('error');
      setTimeout(() => setFaucetStatus('idle'), 4000);
    }
  }

  if (!auth.isNonWallet || !addr) {
    return <ConnectButton />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
      <span className="badge">
        {auth.authMethod === 'zklogin' ? 'Google (zkLogin)' : 'Passkey'}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>
          {addr.slice(0, 6)}…{addr.slice(-4)}
        </span>
        <button
          onClick={handleCopyAddress}
          aria-label="Copy wallet address"
          title={copied ? 'Copied!' : 'Copy address'}
          className="btn-secondary"
          style={{ fontSize: 12, padding: '4px 6px', borderRadius: 6, lineHeight: 1 }}
        >
          {copied ? '✓' : '⧉'}
        </button>
        {NETWORK !== 'mainnet' && (
          <button
            onClick={handleFaucet}
            disabled={faucetStatus === 'pending'}
            aria-label="Request testnet SUI from faucet"
            title="Get testnet SUI for gas"
            className="btn-secondary"
            style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6 }}
          >
            {faucetStatus === 'pending'
              ? '⏳'
              : faucetStatus === 'done'
                ? '✓ Funded'
                : faucetStatus === 'error'
                  ? '⚠ Retry'
                  : '🚰 Faucet'}
          </button>
        )}
        <button
          onClick={auth.logout}
          className="btn-secondary"
          style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6 }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
