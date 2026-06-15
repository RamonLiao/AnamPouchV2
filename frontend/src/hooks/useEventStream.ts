/**
 * Real-time event subscription.
 *
 * TODO(sui-2.x migration): GrpcCoreClient.streamEvents was removed in sui ^2.x.
 * Re-implement via jsonRpc queryEvents polling, custom indexer, or whatever
 * Mysten ships next. Hook is currently a no-op; nothing imports it yet.
 */

import { useEffect, useRef } from 'react';

export type EventCallback<T> = (
  parsed: T,
  raw: { txDigest: string; eventSeq: string; timestampMs?: string },
) => void;

interface Options {
  network?: 'mainnet' | 'testnet' | 'devnet' | 'localnet';
  baseUrl?: string;
}

export function useEventStream<T>(
  moveEventType: string,
  onEvent: EventCallback<T>,
  _opts: Options = {},
) {
  const cbRef = useRef(onEvent);
  cbRef.current = onEvent;

  useEffect(() => {
    console.warn(
      `useEventStream(${moveEventType}) is a no-op pending sui 2.x grpc API. ` +
        `Use jsonRpc queryEvents polling for now.`,
    );
  }, [moveEventType]);
}
