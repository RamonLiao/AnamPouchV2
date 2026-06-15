import { createDAppKit } from '@mysten/dapp-kit-react';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { SealClient, type SealClientOptions, type SealCompatibleClient } from '@mysten/seal';
import { SEAL } from '../config/contract';

const GRPC_URLS: Record<string, string> = {
  testnet: 'https://fullnode.testnet.sui.io:443',
  mainnet: 'https://fullnode.mainnet.sui.io:443',
};

const NETWORK = (import.meta.env.VITE_SUI_NETWORK ?? 'testnet') as 'testnet' | 'mainnet';

export const dAppKit = createDAppKit({
  networks: ['testnet', 'mainnet'],
  defaultNetwork: NETWORK,
  createClient: (network) =>
    new SuiGrpcClient({ network, baseUrl: GRPC_URLS[network]! }),
});

declare module '@mysten/dapp-kit-react' {
  interface Register {
    dAppKit: typeof dAppKit;
  }
}

/**
 * jsonRpc client used for tx-effect introspection (objectChanges) and
 * historical queries that gRPC does not expose. Mirrors the private client in
 * `api/queries.ts` so that the record-creation pipeline can resolve newly
 * created RecordAnchor object IDs from a tx digest.
 */
export const suiJsonRpc = new SuiJsonRpcClient({
  network: NETWORK,
  url: getJsonRpcFullnodeUrl(NETWORK),
});

/**
 * Seal threshold-encryption client. Uses the URL allowlist from `SEAL.keyServerUrls`.
 *
 * NOTE: Seal SDK 1.x `KeyServerConfig` expects `objectId` (not URL). The env
 * var `VITE_SEAL_KEY_SERVERS` is therefore expected to contain comma-separated
 * key-server **object IDs**, despite the legacy field name `keyServerUrls`.
 * TODO(post-hackathon): rename the config field to `keyServerObjectIds`.
 */
const sealOptions: SealClientOptions = {
  suiClient: dAppKit.getClient() as unknown as SealCompatibleClient,
  serverConfigs: SEAL.keyServerUrls.map((objectId: string) => ({ objectId, weight: 1 })),
  verifyKeyServers: true,
};

export const sealClient = new SealClient(sealOptions);
