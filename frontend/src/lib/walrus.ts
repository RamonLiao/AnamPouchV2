export interface UploadOpts {
  publisherUrl: string;
  /** Storage duration in epochs (1 epoch ≈ 24h on testnet). */
  epochs: number;
}

export async function uploadBlob(data: Uint8Array, opts: UploadOpts): Promise<string> {
  const url = `${opts.publisherUrl}/v1/blobs?epochs=${opts.epochs}`;
  const res = await fetch(url, { method: 'PUT', body: data as BodyInit });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Walrus PUT ${res.status}: ${body}`);
  }
  const json = (await res.json()) as { newlyCreated?: { blobObject: { blobId: string } }; alreadyCertified?: { blobId: string } };
  const blobId = json.newlyCreated?.blobObject.blobId ?? json.alreadyCertified?.blobId;
  if (!blobId) throw new Error('Walrus response missing blobId');
  return blobId;
}

export async function fetchBlob(blobId: string, aggregatorUrl: string): Promise<Uint8Array> {
  const res = await fetch(`${aggregatorUrl}/v1/blobs/${blobId}`);
  if (!res.ok) throw new Error(`Walrus GET ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
